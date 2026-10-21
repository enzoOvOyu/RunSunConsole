import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase, persist, restoreDatabase } from "../lib/database";
import {
  checkResourceNetwork,
  interfaceCount,
  syncResourceNetwork,
  releaseResourceNetwork,
} from "../lib/network";
import {
  cidrRange,
  cidrContains,
  cidrOverlaps,
  subnetCapacity,
  evaluateSecurityGroups,
} from "../../lib/network";
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  role = "owner",
) {
  const r = await fetch("http://localhost/api/network" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Role": role },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
const scope = () => ({ projectId: db.projects[0].id, region: "jp" });
async function vpcSetup(cidr = "10.100.0.0/16") {
  const v = (
    await request("/vpcs", "POST", { ...scope(), name: "isolated-vpc", cidr })
  ).data;
  const subnet = (
    await request("/subnets", "POST", {
      ...scope(),
      vpcId: v.id,
      name: "isolated-subnet",
      cidr: "10.100.0.0/29",
      zone: "jp-a",
    })
  ).data;
  const group = (
    await request("/security-groups", "POST", {
      ...scope(),
      vpcId: v.id,
      name: "isolated-sg",
    })
  ).data;
  return { v, subnet, group };
}
async function eip() {
  return (
    await request("/eips", "POST", {
      ...scope(),
      name: "network-test-ip",
      bandwidthMbps: 100,
    })
  ).data;
}
it("validates canonical CIDRs, containment, overlap and four reserved subnet addresses", () => {
  expect(cidrRange("10.0.0.1/24")).toBeNull();
  expect(cidrRange("010.0.0.0/24")).toBeNull();
  expect(cidrRange("10.0.0.0/33")).toBeNull();
  expect(cidrContains("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
  expect(cidrOverlaps("10.0.0.0/24", "10.0.0.128/25")).toBe(true);
  expect(subnetCapacity("10.0.0.0/29")).toBe(4);
});
it("scopes real deployment options and rejects overlapping or cross-project subnets", async () => {
  const { v, subnet } = await vpcSetup();
  expect(v.id).toBeTruthy();
  expect(subnet.availableIps).toBeUndefined();
  expect(
    (
      await request("/subnets", "POST", {
        ...scope(),
        vpcId: v.id,
        name: "duplicate",
        cidr: "10.100.0.0/29",
        zone: "jp-a",
      })
    ).data.code,
  ).toBe("CIDR_OVERLAP");
  expect(
    (
      await request("/subnets", "POST", {
        ...scope(),
        projectId: db.projects[1].id,
        vpcId: v.id,
        name: "mismatch",
        cidr: "10.100.1.0/24",
        zone: "jp-a",
      })
    ).data.code,
  ).toBe("NETWORK_SCOPE_MISMATCH");
  expect(
    (
      await request("/subnets", "POST", {
        ...scope(),
        vpcId: v.id,
        name: "outside",
        cidr: "10.101.0.0/24",
        zone: "jp-a",
      })
    ).status,
  ).toBe(422);
  expect((await request(`/vpcs/${v.id}`, "DELETE")).data.code).toBe(
    "NETWORK_HAS_DEPENDENCIES",
  );
});
it("allocates unique per-member addresses, reserves peak capacity and retains private addresses on stop", async () => {
  const { v, subnet, group } = await vpcSetup();
  const r = structuredClone(
    db.resources.find(
      (r) =>
        r.kind === "gpu_vm" &&
        r.projectId === scope().projectId &&
        r.region === "jp",
    )!,
  );
  if (r.kind !== "gpu_vm") throw Error("fixture");
  r.spec = {
    ...r.spec,
    quantity: 4,
    publicIp: false,
    vpc: v.id,
    subnet: subnet.id,
    securityGroups: [group.id],
  };
  releaseResourceNetwork(db.network, r.resourceUuid);
  checkResourceNetwork(db.network, r);
  syncResourceNetwork(db.network, r);
  const nics = db.network.interfaces.filter(
    (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
  );
  expect(nics).toHaveLength(4);
  expect(new Set(nics.map((i) => i.privateIp)).size).toBe(4);
  expect(() => checkResourceNetwork(db.network, r, 2)).toThrow(
    "SUBNET_EXHAUSTED",
  );
  r.status = "stopped";
  syncResourceNetwork(db.network, r);
  expect(
    db.network.interfaces
      .filter((i) => i.resourceUuid === r.resourceUuid && !i.releasedAt)
      .map((i) => i.privateIp),
  ).toEqual(nics.map((i) => i.privateIp));
  expect((await request(`/subnets/${subnet.id}`, "DELETE")).status).toBe(409);
  releaseResourceNetwork(db.network, r.resourceUuid);
  expect((await request(`/subnets/${subnet.id}`, "DELETE")).status).toBe(204);
  expect(
    (await request(`/subnets/${subnet.id}`, "PATCH", { name: "resurrect" }))
      .status,
  ).toBe(410);
});
it("assigns bare metal to its dedicated VPC and exposes distinct VPC types", async () => {
  const baremetal = db.resources.find(
    (resource) => resource.kind === "gpu_baremetal",
  )!;
  const selected = db.network.vpcs.find((vpc) => vpc.id === baremetal.spec.vpc);
  expect(selected?.networkType).toBe("baremetal");
  expect(selected?.id).toContain("vpc-bm-");
  const options = await fetch(
    `http://localhost/api/deployment-options?region=${baremetal.region}&project_id=${baremetal.projectId}&kind=gpu_baremetal`,
  );
  const payload = (await options.json()) as {
    vpcs: { networkType?: string }[];
  };
  expect(payload.vpcs.length).toBeGreaterThan(0);
  expect(payload.vpcs.every((vpc) => vpc.networkType === "baremetal")).toBe(
    true,
  );
  const created = await request("/vpcs", "POST", {
    ...scope(),
    name: "baremetal-net",
    cidr: "172.28.0.0/16",
    networkType: "baremetal",
  });
  expect(created.data.networkType).toBe("baremetal");
});
it("rejects cross-region VPC and security groups and counts each cluster member", () => {
  for (const r of db.resources)
    expect(
      db.network.interfaces.filter(
        (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
      ),
    ).toHaveLength(interfaceCount(r));
  const r = structuredClone(db.resources[0]);
  r.spec.vpc = `vpc-${r.projectId}-${r.region === "jp" ? "sg" : "jp"}`;
  expect(() => checkResourceNetwork(db.network, r)).toThrow(
    "NETWORK_SCOPE_MISMATCH",
  );
});
it("enforces one EIP per VM interface, retains allocation across unbind/stop, and releases with confirmation", async () => {
  const e = await eip(),
    second = await eip();
  const nic = db.network.interfaces.find(
    (i) =>
      i.kind === "gpu_vm" &&
      i.projectId === e.projectId &&
      i.region === e.region &&
      !db.network.eips.some((e) => e.interfaceId === i.id),
  )!;
  expect(nic).toBeTruthy();
  expect(
    (await request(`/eips/${e.id}/bind`, "POST", { interfaceId: nic.id }))
      .status,
  ).toBe(200);
  expect(
    (await request(`/eips/${second.id}/bind`, "POST", { interfaceId: nic.id }))
      .data.code,
  ).toBe("EIP_IN_USE");
  expect(
    (await request(`/eips/${e.id}?confirm=${e.displayId}`, "DELETE")).status,
  ).toBe(409);
  db.resources.find((r) => r.resourceUuid === nic.resourceUuid)!.status =
    "stopped";
  expect(db.network.eips.find((x) => x.id === e.id)!.releasedAt).toBeNull();
  expect(
    (await request(`/eips/${e.id}/unbind`, "POST", {})).data.hourly,
  ).toBeGreaterThan(0);
  expect((await request(`/eips/${e.id}?confirm=wrong`, "DELETE")).status).toBe(
    422,
  );
  expect(
    (await request(`/eips/${e.id}?confirm=${e.displayId}`, "DELETE")).data
      .releasedAt,
  ).toBeTruthy();
  expect(
    (await request(`/eips/${e.id}/bind`, "POST", { interfaceId: nic.id }))
      .status,
  ).toBe(410);
});
it("bills idle EIPs independently and never duplicates new compute IP meters", async () => {
  const e = await eip();
  const now = Date.now();
  const startingBalance = db.account.creditBalance;
  for (const r of db.resources) r.status = "stopped";
  for (const ip of db.network.eips) db.billingCursors[ip.id] = now;
  vi.spyOn(Date, "now").mockReturnValue(now + 3600000);
  try {
    await request("/eips");
    const rows = db.usage.filter((u) => u.resourceUuid === e.id);
    expect(rows.reduce((n, u) => n + u.quantity, 0)).toBeCloseTo(1, 3);
    expect(
      rows.every((u) => u.kind === "eip" && u.unit === "per_ip_hour"),
    ).toBe(true);
    const charges = db.transactions.filter((t) => t.resourceUuid === e.id);
    expect(-charges.reduce((n, t) => n + t.amount, 0)).toBeCloseTo(
      rows.reduce((n, u) => n + u.amount, 0),
      4,
    );
    expect(db.account.creditBalance).toBeLessThan(startingBalance);
    const count = rows.length;
    await request("/eips");
    expect(db.usage.filter((u) => u.resourceUuid === e.id)).toHaveLength(count);
    persist();
  } finally {
    vi.restoreAllMocks();
  }
});
it("applies stateful security priorities, deny ties, default egress and rule CRUD", async () => {
  const { group } = await vpcSetup();
  const body = {
    direction: "inbound",
    action: "allow",
    protocol: "tcp",
    cidr: "0.0.0.0/0",
    portFrom: 443,
    portTo: 443,
    priority: 10,
    description: "https",
  };
  const added = await request(
    `/security-groups/${group.id}/rules`,
    "POST",
    body,
  );
  expect(added.status).toBe(201);
  const deny = (
    await request(`/security-groups/${group.id}/rules`, "POST", {
      ...body,
      action: "deny",
    })
  ).data;
  const g = db.network.groups.find((g) => g.id === group.id)!;
  const packet = {
    direction: "inbound" as const,
    protocol: "tcp" as const,
    address: "203.0.113.7",
    port: 443,
  };
  expect(evaluateSecurityGroups([g], packet)).toBe("deny");
  expect(evaluateSecurityGroups([g], { ...packet, established: true })).toBe(
    "allow",
  );
  await request(`/security-groups/${group.id}/rules/${deny.id}`, "DELETE");
  expect(evaluateSecurityGroups([g], packet)).toBe("allow");
  expect(evaluateSecurityGroups([g], { ...packet, port: 22 })).toBe("deny");
  expect(
    evaluateSecurityGroups([g], { ...packet, direction: "outbound" }),
  ).toBe("allow");
  expect(
    (
      await request(`/security-groups/${group.id}/rules`, "POST", {
        ...body,
        portFrom: 500,
        portTo: 10,
      })
    ).status,
  ).toBe(422);
});
it("validates tunnel route dependencies and never stores or returns the PSK", async () => {
  const { v, subnet } = await vpcSetup();
  const e = await eip();
  const psk = "secret-network-key-12345";
  const body = {
    ...scope(),
    name: "office-ipsec",
    vpcId: v.id,
    subnetId: subnet.id,
    eipId: e.id,
    peerIp: "203.0.113.250",
    localCidr: v.cidr,
    remoteCidr: "192.168.0.0/16",
    psk,
  };
  const result = await request("/tunnels", "POST", body);
  expect(result.status).toBe(201);
  expect(JSON.stringify(result.data)).not.toContain(psk);
  expect(JSON.stringify(db.network)).not.toContain(psk);
  expect((await request(`/eips/${e.id}/unbind`, "POST", {})).status).toBe(409);
  expect((await request(`/subnets/${subnet.id}`, "DELETE")).status).toBe(409);
  const t = result.data;
  await request(`/tunnels/${t.id}`, "PATCH", { enabled: true });
  expect((await request(`/tunnels/${t.id}`, "DELETE")).status).toBe(409);
  const another = await eip();
  expect(
    (await request("/tunnels", "POST", { ...body, eipId: another.id })).data
      .code,
  ).toBe("CIDR_OVERLAP");
  expect(
    (
      await request(`/tunnels/${t.id}`, "PATCH", {
        enabled: false,
        psk: "short",
      })
    ).status,
  ).toBe(422);
  expect(db.network.tunnels.find((x) => x.id === t.id)!.enabled).toBe(true);
  await request(`/tunnels/${t.id}`, "PATCH", { enabled: false });
  expect((await request(`/tunnels/${t.id}`, "DELETE")).status).toBe(204);
  expect(db.network.eips.find((x) => x.id === e.id)!.tunnelId).toBeNull();
  expect(db.network.eips.find((x) => x.id === e.id)!.releasedAt).toBeNull();
});
it("protects defaults and all mutation routes for read-only roles", async () => {
  const v = db.network.vpcs[0];
  expect((await request(`/vpcs/${v.id}`, "DELETE")).data.code).toBe(
    "DEFAULT_NETWORK",
  );
  for (const path of [
    "/vpcs",
    "/subnets",
    "/security-groups",
    "/eips",
    "/tunnels",
  ])
    expect((await request(path, "POST", scope(), "viewer")).status).toBe(403);
  expect((await request("/vpcs", "GET", undefined, "billing")).status).toBe(
    403,
  );
  expect((await request("/eips", "GET", undefined, "billing")).status).toBe(
    200,
  );
});

it("links regional network quotas to create, delete and retained EIPs", async () => {
  const quotas = async () =>
    (await request("/quotas?region=jp")).data as {
      metric: string;
      usedValue: number;
      limitValue: number;
      remaining: number;
    }[];
  const before = await quotas();
  const { v, subnet, group } = await vpcSetup();
  const after = await quotas();
  for (const metric of ["vpc", "subnet", "security_group"])
    expect(after.find((q) => q.metric === metric)!.usedValue).toBe(
      before.find((q) => q.metric === metric)!.usedValue + 1,
    );
  await request(`/security-groups/${group.id}`, "DELETE");
  await request(`/subnets/${subnet.id}`, "DELETE");
  await request(`/vpcs/${v.id}`, "DELETE");
  expect((await quotas()).find((q) => q.metric === "vpc")!.usedValue).toBe(
    before.find((q) => q.metric === "vpc")!.usedValue,
  );
  const e = await eip();
  const retained = (await quotas()).find((q) => q.metric === "ip")!;
  expect(retained.usedValue).toBe(
    before.find((q) => q.metric === "ip")!.usedValue + 1,
  );
  await request(`/eips/${e.id}/unbind`, "POST", {});
  expect((await quotas()).find((q) => q.metric === "ip")!.usedValue).toBe(
    retained.usedValue,
  );
  await request(`/eips/${e.id}?confirm=${e.displayId}`, "DELETE");
  expect((await quotas()).find((q) => q.metric === "ip")!.usedValue).toBe(
    retained.usedValue - 1,
  );
  expect(
    (await request("/quotas?region=sg")).data.every(
      (q: { region: string }) => q.region === "sg",
    ),
  ).toBe(true);
});
it("rejects regional network and EIP quota overflow without partial writes", async () => {
  const list = (await request("/quotas?region=jp")).data as {
    metric: string;
    limitValue: number;
  }[];
  const v = db.network.vpcs.find((v) => v.region === "jp")!;
  const limit = list.find((q) => q.metric === "vpc")!.limitValue;
  while (
    db.network.vpcs.filter((v) => v.region === "jp" && !v.deletedAt).length <
    limit
  )
    db.network.vpcs.push({ ...v, id: crypto.randomUUID(), isDefault: false });
  const count = db.network.vpcs.length;
  expect(
    (
      await request("/vpcs", "POST", {
        ...scope(),
        name: "overflow",
        cidr: "10.100.0.0/16",
      })
    ).data.code,
  ).toBe("QUOTA_EXCEEDED");
  expect(db.network.vpcs).toHaveLength(count);
  const ipLimit = list.find((q) => q.metric === "ip")!.limitValue;
  while (
    db.network.eips.filter((e) => e.region === "jp" && !e.releasedAt).length <
    ipLimit
  )
    await eip();
  const before = db.network.eips.length;
  expect(
    (
      await request("/eips", "POST", {
        ...scope(),
        name: "overflow-ip",
        bandwidthMbps: 100,
      })
    ).data.code,
  ).toBe("QUOTA_EXCEEDED");
  expect(db.network.eips).toHaveLength(before);
});
it("round-trips EIP usage and migrates old snapshots without losing compute resources or bills", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  try {
    const e = await eip();
    db.usage.push({
      id: "network-roundtrip",
      resourceUuid: e.id,
      displayId: e.displayId,
      projectId: e.projectId,
      region: e.region,
      kind: "eip",
      usageHour: new Date().toISOString(),
      unit: "per_ip_hour",
      quantity: 1,
      unitPrice: 0.01,
      amount: 0.01,
      status: "running",
    });
    persist();
    const restored = restoreDatabase();
    expect(
      restored.usage.find((u) => u.id === "network-roundtrip")!.resourceUuid,
    ).toBe(e.id);
    expect(restored.network.eips.find((x) => x.id === e.id)).toBeTruthy();
    const old = JSON.parse(storage.get("rs.mock.database.v2")!);
    const moved = old.resources.find(
      (r: { region: string }) => r.region === "jp",
    );
    const projectId = moved.projectId;
    const oldVpcId = `vpc-${projectId}-th`;
    const oldSubnetId = `vsw-${projectId}-th-a`;
    const oldGroupId = `sg-${projectId}-th-default`;
    old.network.vpcs.push({
      ...old.network.vpcs.find(
        (v: { id: string }) => v.id === `vpc-${projectId}-jp`,
      ),
      id: oldVpcId,
      region: "th",
    });
    old.network.subnets.push({
      ...old.network.subnets.find(
        (v: { id: string }) => v.id === `vsw-${projectId}-jp-a`,
      ),
      id: oldSubnetId,
      vpcId: oldVpcId,
      region: "th",
    });
    old.network.groups.push({
      ...old.network.groups.find(
        (v: { id: string }) => v.id === `sg-${projectId}-jp-default`,
      ),
      id: oldGroupId,
      vpcId: oldVpcId,
      region: "th",
    });
    moved.region = "th";
    moved.spec.vpc = "default-vpc";
    moved.spec.subnet = "th-default";
    moved.spec.securityGroups = ["default"];
    storage.set("rs.mock.database.v2", JSON.stringify(old));
    const relocated = restoreDatabase();
    const relocatedResource = relocated.resources.find(
      (r) => r.resourceUuid === moved.resourceUuid,
    )!;
    expect(relocatedResource.region).toBe("jp");
    expect(relocatedResource.spec.vpc).toBe(oldVpcId);
    expect(relocatedResource.spec.subnet).toBe(oldSubnetId);
    expect(relocatedResource.spec.securityGroups).toEqual([oldGroupId]);
    expect(relocated.network.vpcs.find((v) => v.id === oldVpcId)?.region).toBe(
      "jp",
    );
    delete old.network;
    old.usage = old.usage.filter((u: unknown[]) => typeof u[1] === "number");
    storage.set("rs.mock.database.v2", JSON.stringify(old));
    const migrated = restoreDatabase();
    expect(migrated.resources.map((r) => r.resourceUuid)).toEqual(
      db.resources.map((r) => r.resourceUuid),
    );
    expect(migrated.resources.reduce((n, r) => n + r.spec.gpuCount, 0)).toBe(
      db.resources.reduce((sum, resource) => sum + resource.spec.gpuCount, 0),
    );
    expect(migrated.usage).toHaveLength(old.usage.length);
    expect(migrated.network.interfaces.length).toBeGreaterThan(
      migrated.resources.length,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("deploys into a selected isolated VPC and meters one EIP per VM without duplicate compute charges", async () => {
  const { v, subnet, group } = await vpcSetup();
  const template = db.resources.find(
    (r) =>
      r.kind === "gpu_vm" &&
      r.projectId === scope().projectId &&
      r.region === "jp",
  )!;
  if (template.kind !== "gpu_vm") throw Error("fixture");
  const spec = {
    ...structuredClone(template.spec),
    quantity: 2,
    publicIp: true,
    scaling: null,
    vpc: v.id,
    subnet: subnet.id,
    securityGroups: [group.id],
    authMethod: "ssh_key",
    sshPubkey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO",
  };
  const res = await fetch("http://localhost/api/deployment-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Role": "owner" },
    body: JSON.stringify({
      kind: "gpu_vm",
      name: "isolated-vm-pair",
      projectId: scope().projectId,
      region: "jp",
      mode: "on_demand",
      labels: [],
      nodePool: template.nodePool,
      spec,
    }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  const r = db.resources.find(
    (r) => r.resourceUuid === data.resource.resourceUuid,
  )!;
  const nics = db.network.interfaces.filter(
    (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
  );
  expect(nics).toHaveLength(2);
  expect(
    nics.every(
      (i) =>
        i.vpcId === v.id &&
        i.subnetId === subnet.id &&
        i.securityGroupIds.includes(group.id),
    ),
  ).toBe(true);
  const ips = db.network.eips.filter((e) =>
    nics.some((i) => i.id === e.interfaceId),
  );
  expect(ips).toHaveLength(2);
  for (const other of db.resources) other.status = "stopped";
  r.status = "running";
  r.runningSince = new Date().toISOString();
  db.billingCursors[r.resourceUuid] = Date.now();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3600000);
  try {
    await request("/eips");
    expect(
      db.usage
        .filter((u) => u.resourceUuid === r.resourceUuid)
        .some((u) => u.unit === "per_ip_hour"),
    ).toBe(false);
    for (const e of ips)
      expect(
        db.usage
          .filter((u) => u.resourceUuid === e.id)
          .reduce((n, u) => n + u.quantity, 0),
      ).toBeCloseTo(1, 3);
  } finally {
    vi.restoreAllMocks();
  }
});

it("keeps deployment and association security groups within one-to-five distinct groups", async () => {
  const r = structuredClone(db.resources.find((r) => r.kind === "gpu_vm")!);
  const id = r.spec.securityGroups![0];
  r.spec.securityGroups = [id, id];
  expect(() => checkResourceNetwork(db.network, r)).toThrow("VALIDATION_ERROR");
  r.spec.securityGroups = Array.from({ length: 6 }, () => id);
  expect(() => checkResourceNetwork(db.network, r)).toThrow("VALIDATION_ERROR");
  expect(cidrRange("10.0.0.0/08")).toBeNull();
  const actual = db.resources.find((r) => r.kind === "gpu_vm")!;
  expect(
    (
      await request(
        `/security-groups/${actual.spec.securityGroups![0]}/associate`,
        "POST",
        { resourceUuid: actual.resourceUuid, remove: true },
      )
    ).status,
  ).toBe(422);
});
