import { defaultSpec, defaultScaling } from "../../lib/config";
import { poolsFor } from "../fixtures/gpu-specs";
import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { allocatedMemoryGb, quotaUse } from "../lib/derive";
import { REGIONS, QUOTA_METRICS } from "../../types/domain";
import { GPU_SPECS } from "../fixtures/gpu-specs";
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch("http://localhost/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Role": "owner" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
it("distributes allocations by region and type with comparable GPU totals and typed quantities", async () => {
  const overview = (await request("/overview")).data;
  expect(overview.distribution).toHaveLength(12);
  expect(
    overview.distribution.reduce(
      (n: number, c: { gpuCount: number }) => n + c.gpuCount,
      0,
    ),
  ).toBe(overview.allocated);
  expect(overview).not.toHaveProperty("regions");
  for (const cell of overview.distribution) {
    const rows = db.resources.filter(
      (r) => !r.deletedAt && r.kind === cell.kind && r.region === cell.region,
    );
    expect(cell.gpuCount).toBe(
      rows.reduce((n, r) => n + quotaUse(r, "gpu"), 0),
    );
    expect(cell.unitCount).toBe(
      rows.reduce(
        (n, r) =>
          n +
          (r.kind === "gpu_vm"
            ? r.spec.quantity
            : r.kind === "gpu_baremetal"
              ? r.spec.machineCount
              : r.kind === "inference"
                ? r.spec.replicas
                : 1),
        0,
      ),
    );
  }
  expect(
    overview.distribution.find(
      (c: { region: string; kind: string }) =>
        c.region === "jp" && c.kind === "gpu_baremetal",
    ).unitCount,
  ).toBe(14);
});
it("shares one quota snapshot between overview and regional quota pages", async () => {
  const overview = (await request("/overview")).data;
  const allQuotas = (await request("/quotas")).data;
  expect(overview.quotas).toEqual(allQuotas);
  for (const region of REGIONS) {
    const regional = (await request(`/quotas?region=${region}`)).data;
    expect(regional).toEqual(
      overview.quotas.filter(
        (quota: { region: string }) => quota.region === region,
      ),
    );
  }
  const storage = allQuotas.filter(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(
    storage.reduce(
      (sum: number, quota: { usedValue: number }) => sum + quota.usedValue,
      0,
    ),
  ).toBe(
    db.volumes
      .filter((volume) => !volume.deletedAt)
      .reduce((sum, volume) => sum + volume.sizeGb, 0) +
      db.buckets.reduce((sum, bucket) => sum + bucket.objects.reduce((bytes, object) => bytes + object.size, 0) / 1e9, 0),
  );
  expect(
    storage.every(
      (quota: {
        usedValue: number;
        limitValue: number;
        storageBreakdown: { usedGb: number; limitGb: number }[];
      }) =>
        quota.usedValue ===
          quota.storageBreakdown.reduce((sum, item) => sum + item.usedGb, 0) &&
        quota.limitValue ===
          quota.storageBreakdown.reduce((sum, item) => sum + item.limitGb, 0),
    ),
  ).toBe(true);
});
it("keeps resources and their billing, storage, network and workbench references linked", async () => {
  const overview = (await request("/overview")).data;
  const resources = (await request("/resources?size=1000")).data.items;
  const ids = new Set(
    resources.map(
      (resource: { resourceUuid: string }) => resource.resourceUuid,
    ),
  );
  expect(
    overview.resources
      .map((resource: { resourceUuid: string }) => resource.resourceUuid)
      .sort(),
  ).toEqual(
    resources
      .map((resource: { resourceUuid: string }) => resource.resourceUuid)
      .sort(),
  );
  for (const row of [
    ...db.volumes,
    ...db.usage,
    ...db.orders,
    ...db.events,
    ...db.policies,
    ...db.scalingEvents,
    ...db.notebooks,
    ...db.network.interfaces,
  ])
    if (row.resourceUuid) expect(ids.has(row.resourceUuid)).toBe(true);
  for (const transaction of db.transactions)
    if (transaction.resourceUuid)
      expect(ids.has(transaction.resourceUuid)).toBe(true);
  for (const bucket of db.buckets)
    if (bucket.attachedResourceUuid)
      expect(ids.has(bucket.attachedResourceUuid)).toBe(true);
});
it("computes host RAM from VM, physical machine, node pool and replica allocations", async () => {
  const quotas = (await request("/quotas")).data;
  expect(quotas).toHaveLength(REGIONS.length * QUOTA_METRICS.length);
  let allocatedStorageGb = 0;
  for (const region of REGIONS) {
    const rows = db.resources.filter((r) => r.region === region);
    const storage = quotas.find(
      (q: { region: string; metric: string }) =>
        q.region === region && q.metric === "storage",
    );
    expect(
      storage.storageBreakdown.map((item: { kind: string }) => item.kind),
    ).toEqual(["block", "file", "object"]);
    const regionStorageGb = storage.storageBreakdown.reduce(
      (sum: number, item: { usedGb: number }) => sum + item.usedGb,
      0,
    );
    expect(regionStorageGb).toBe(storage.usedValue);
    allocatedStorageGb += regionStorageGb;
    const memory = quotas.find(
      (q: { region: string; metric: string }) =>
        q.region === region && q.metric === "memory",
    );
    expect(memory.usedValue).toBe(
      rows.reduce((n, r) => n + quotaUse(r, "memory"), 0),
    );
    expect(memory.usedValue).toBeGreaterThan(
      rows.reduce((n, r) => n + quotaUse(r, "gpu"), 0) * 100,
    );
    expect(memory.limitValue).toBeGreaterThanOrEqual(memory.usedValue);
  }
  expect(allocatedStorageGb).toBe(
    db.volumes
      .filter((volume) => !volume.deletedAt)
      .reduce((sum, volume) => sum + volume.sizeGb, 0) +
      db.buckets.reduce((sum, bucket) => sum + bucket.objects.reduce((bytes, object) => bytes + object.size, 0) / 1e9, 0),
  );
  for (const r of db.resources) {
    if (r.kind === "gpu_baremetal")
      expect(allocatedMemoryGb(r)).toBe(r.spec.memoryGb * r.spec.machineCount);
    if (r.kind === "vgpu")
      expect(allocatedMemoryGb(r)).toBe(
        r.spec.nodePools.reduce(
          (n, p) => n + GPU_SPECS[p.poolCode].memorySystemGb * p.nodeCount,
          0,
        ),
      );
    if (r.kind === "gpu_vm")
      expect(allocatedMemoryGb(r)).toBe(r.spec.memoryGb * r.spec.quantity);
    if (r.kind === "inference")
      expect(allocatedMemoryGb(r)).toBe(
        Math.round(
          (GPU_SPECS[r.nodePool].memorySystemGb /
            GPU_SPECS[r.nodePool].gpusPerNode) *
            r.spec.gpuCount,
        ),
      );
  }
});
it("releases host RAM on stop while cloud storage remains allocated", async () => {
  const r = db.resources.find(
    (r) => r.kind === "gpu_baremetal" && r.status === "running",
  )!;
  const ram = quotaUse(r, "memory");
  const storage = quotaUse(r, "storage");
  expect(ram).toBeGreaterThan(8000);
  expect(
    (await request(`/resources/${r.resourceUuid}/stop`, "POST", {})).status,
  ).toBe(200);
  expect(quotaUse(r, "memory")).toBe(0);
  expect(quotaUse(r, "storage")).toBe(storage);
});
it("lists every bare metal machine with distinct identities and correct cluster totals", async () => {
  for (const r of db.resources) {
    if (r.kind !== "gpu_baremetal") continue;
    const result = await request(`/resources/${r.resourceUuid}/machines`);
    expect(result.status).toBe(200);
    const machines = result.data;
    expect(machines).toHaveLength(r.spec.machineCount);
    const detail = (await request(`/resources/${r.resourceUuid}`)).data;
    expect(
      detail.placement.nodes.map((n: { nodeUuid: string }) => n.nodeUuid),
    ).toEqual(machines.map((m: { nodeUuid: string }) => m.nodeUuid));
    for (const key of ["nodeUuid", "name", "hostname", "privateIp", "bmcIp"])
      expect(
        new Set(machines.map((m: Record<string, string>) => m[key])).size,
      ).toBe(r.spec.machineCount);
    expect(
      machines.reduce(
        (n: number, m: { gpuCount: number }) => n + m.gpuCount,
        0,
      ),
    ).toBe(r.spec.gpuCount);
    expect(
      machines.reduce(
        (n: number, m: { memoryGb: number }) => n + m.memoryGb,
        0,
      ),
    ).toBe(r.spec.memoryGb * r.spec.machineCount);
    expect(
      machines.reduce(
        (n: number, m: { localNvmeGb: number }) => n + m.localNvmeGb,
        0,
      ),
    ).toBe(r.spec.localNvmeGb * r.spec.machineCount);
    for (const m of machines)
      expect(m).toMatchObject({
        gpuModel: r.spec.gpuModel,
        cpuModel: r.spec.cpuModel,
        status: r.status,
      });
  }
  const vm = db.resources.find((r) => r.kind === "gpu_vm")!;
  expect((await request(`/resources/${vm.resourceUuid}/machines`)).status).toBe(
    404,
  );
});
it("returns hardware and monitoring for the selected machine and validates its index", async () => {
  const r = db.resources.find(
    (r) => r.kind === "gpu_baremetal" && r.status === "running",
  )!;
  const machines = (await request(`/resources/${r.resourceUuid}/machines`))
    .data;
  for (const index of [0, 1]) {
    const hardware = (
      await request(
        `/metrics/${r.kind}/${r.resourceUuid}/hardware?node=${index}`,
      )
    ).data;
    expect(hardware.nodeUid).toBe(machines[index].name);
    expect(hardware.bmc.ip).toBe(machines[index].bmcIp);
  }
  const first = (
    await request(
      `/metrics/${r.kind}/${r.resourceUuid}?node=0&metrics=gpu_temperature`,
    )
  ).data;
  const second = (
    await request(
      `/metrics/${r.kind}/${r.resourceUuid}?node=1&metrics=gpu_temperature`,
    )
  ).data;
  expect(first[0].points).not.toEqual(second[0].points);
  expect(
    (
      await request(
        `/metrics/${r.kind}/${r.resourceUuid}?node=${machines.length}`,
      )
    ).status,
  ).toBe(422);
  expect(
    (await request(`/metrics/${r.kind}/${r.resourceUuid}/hardware?node=-1`))
      .status,
  ).toBe(422);
});
it("keeps configured cloud storage consistent with VM disks and cluster PVCs", () => {
  for (const r of db.resources) {
    if (r.kind === "gpu_vm")
      expect(r.spec.storageGb).toBe(
        (r.spec.systemDiskGb + r.spec.dataDiskGb) * r.spec.quantity,
      );
    if (r.kind === "vgpu") expect(r.spec.storageGb).toBe(r.spec.defaultPvcGb *
      (["dynamic_block", "existing_block"].includes(r.spec.storageMode || "")
        ? r.spec.nodePools.reduce((count, pool) => count + pool.nodeCount, 0) : 1));
  }
});

it("checks peak RAM allocation before admitting an elastic deployment", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("sg")[0]);
  if (!("memoryGb" in spec && "quantity" in spec))
    throw new Error("Expected VM");
  spec.memoryGb = 8192;
  spec.subnet = "sg-default";
  spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO";
  spec.scaling = { ...defaultScaling("gpu_vm"), max_size: 16 };
  const body = {
    kind: "gpu_vm",
    name: "memory-contract",
    projectId: "default",
    region: "sg",
    nodePool: "H100_SXM",
    mode: "on_demand",
    labels: [],
    spec,
  };
  const refused = await request("/deployment-orders", "POST", body);
  expect(refused.status).toBe(409);
  expect(refused.data.code).toBe("QUOTA_EXCEEDED");
  expect(refused.data.metric).toBe("memory");
  spec.scaling = null;
  expect((await request("/deployment-orders", "POST", body)).status).toBe(201);
});

it("keeps overview, region quota, project and model totals aligned after stopping compute", async () => {
  const active = db.resources.find(
    (resource) => resource.status === "running" && resource.spec.gpuCount > 0,
  )!;
  const before = (await request("/overview")).data;
  const beforeQuota = (
    await request(`/quotas?region=${active.region}`)
  ).data.find((quota: { metric: string }) => quota.metric === "gpu");
  expect(
    (await request(`/resources/${active.resourceUuid}/stop`, "POST", {}))
      .status,
  ).toBe(200);
  const after = (await request("/overview")).data;
  const afterQuota = (
    await request(`/quotas?region=${active.region}`)
  ).data.find((quota: { metric: string }) => quota.metric === "gpu");
  const project = (await request(`/projects/${active.projectId}/summary`)).data;
  expect(after.allocated).toBe(before.allocated - active.spec.gpuCount);
  expect(afterQuota.usedValue).toBe(
    beforeQuota.usedValue - active.spec.gpuCount,
  );
  expect(
    after.distribution.reduce(
      (sum: number, cell: { gpuCount: number }) => sum + cell.gpuCount,
      0,
    ),
  ).toBe(after.allocated);
  expect(project.gpuTotal).toBe(
    db.resources
      .filter((resource) => resource.projectId === active.projectId)
      .reduce((sum, resource) => sum + quotaUse(resource, "gpu"), 0),
  );
});
