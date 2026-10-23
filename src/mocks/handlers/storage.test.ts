import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { defaultSpec, normalizeSpec } from "../../lib/config";
import { poolsFor } from "../fixtures/gpu-specs";
import { estimate } from "../lib/derive";
import { RATES } from "../fixtures/pricing";
import { storageSelectionsSchema } from "../../lib/schema";
import { clusterView } from "../lib/runtime";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch("http://localhost/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Role": "owner" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
const selections = [
  {
    key: "block-1",
    kind: "block" as const,
    tier: "essd_pl1",
    name: "fast-data",
    sizeGb: 100,
    count: 2,
    mountPath: "/mnt/fast",
  },
  {
    key: "file-1",
    kind: "file" as const,
    tier: "nas_capacity",
    name: "shared-data",
    sizeGb: 200,
    count: 1,
    mountPath: "/mnt/shared",
  },
  {
    key: "object-1",
    kind: "object" as const,
    tier: "oss_ia",
    name: "runsun-test-object-bucket",
    sizeGb: 500,
    count: 1,
    mountPath: "",
  },
];
it("validates storage tiers and prices allocated block and file capacity", () => {
  expect(storageSelectionsSchema.safeParse(selections).success).toBe(true);
  expect(
    storageSelectionsSchema.safeParse([{ ...selections[0], tier: "oss_ia" }])
      .success,
  ).toBe(false);
  const pool = poolsFor("jp")[0];
  const base = normalizeSpec(defaultSpec("gpu_vm", pool));
  const spec = normalizeSpec({ ...base, storageSelections: selections });
  expect(spec.storageGb).toBe(base.storageGb + 400);
  const lines = estimate(
    {
      kind: "gpu_vm",
      region: "jp",
      nodePool: pool.code,
      mode: "on_demand",
      spec,
    },
    RATES,
  ).lines;
  expect(
    lines.find((line) => line.key === "storage:block-1")?.hourly,
  ).toBeCloseTo((200 * 0.14) / 730);
  expect(
    lines.find((line) => line.key === "storage:file-1")?.hourly,
  ).toBeCloseTo((200 * 0.15) / 730);
  expect(lines.some((line) => line.key === "storage:object-1")).toBe(false);
});
it("creates block volumes without assigning OS mount paths", async () => {
  const before = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  const pool = poolsFor("jp")[0];
  const spec = normalizeSpec({
    ...defaultSpec("gpu_vm", pool),
    storageSelections: [selections[0]],
    sshPubkey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISEED",
  });
  const order = await request("/deployment-orders", "POST", {
    kind: "gpu_vm",
    region: "jp",
    projectId: db.projects[0].id,
    name: "storage-test-vm",
    nodePool: pool.code,
    mode: "on_demand",
    labels: [],
    spec,
    agree: true,
  });
  expect(order.status).toBe(201);
  const resource = order.data.resource;
  const volumes = (await request("/storage/volumes?region=jp")).data.filter(
    (v: { resourceUuid: string }) => v.resourceUuid === resource.resourceUuid,
  );
  expect(
    volumes.filter((v: { role: string }) => v.role === "custom"),
  ).toHaveLength(2);
  expect(volumes.filter((v: { role: string }) => v.role === "custom").every((v: { mountPath: string }) => !v.mountPath)).toBe(true);
  expect((await request("/storage/products")).data.length).toBeGreaterThan(5);
  const after = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(after.usedValue - before.usedValue).toBe(300);
  expect(after.storageBreakdown).toEqual(
    before.storageBreakdown.map(
      (item: { kind: string; usedGb: number; limitGb: number }) => ({
        ...item,
        usedGb: item.usedGb + (item.kind === "block" ? 300 : 0),
      }),
    ),
  );
});

it("creates and deletes standalone block and file volumes with regional quota updates", async () => {
  const before = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  for (const [kind, tier, sizeGb] of [
    ["block", "essd_pl1", 100],
    ["file", "nas_capacity", 200],
  ] as const) {
    const created = await request("/storage/volumes", "POST", {
      name: `${kind}-standalone`,
      kind,
      tier,
      sizeGb,
      projectId: db.projects[0].id,
      region: "jp",
    });
    expect(created.status).toBe(201);
    expect(created.data.resourceUuid).toBeNull();
    expect(created.data.role).toBe("custom");
    expect((await request(`/storage/volumes/${created.data.id}`)).status).toBe(
      200,
    );
    const current = (await request("/quotas?region=jp")).data.find(
      (quota: { metric: string }) => quota.metric === "storage",
    );
    expect(
      current.storageBreakdown.find(
        (item: { kind: string }) => item.kind === kind,
      ).usedGb,
    ).toBe(
      before.storageBreakdown.find(
        (item: { kind: string }) => item.kind === kind,
      ).usedGb + sizeGb,
    );
    const deleted = await fetch(
      `http://localhost/api/storage/volumes/${created.data.id}`,
      {
        method: "DELETE",
        headers: { "X-Role": "owner" },
      },
    );
    expect(deleted.status).toBe(204);
  }
  const after = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(after.usedValue).toBe(before.usedValue);
  const attached = db.volumes.find((volume) => volume.resourceUuid);
  expect(attached).toBeDefined();
  const blocked = await fetch(
    `http://localhost/api/storage/volumes/${attached?.id}`,
    {
      method: "DELETE",
      headers: { "X-Role": "owner" },
    },
  );
  expect(blocked.status).toBe(409);
});

it("keeps legacy regional capacity pools out of tenant file systems", async () => {
  const pool = db.volumes.find((item) => item.id === "vol-jp-file-allocated-1")!;
  expect(pool).toBeDefined();
  delete pool.inventoryScope;
  const files = (await request("/storage/volumes?region=jp")).data;
  expect(files.some((item: { id: string }) => item.id === pool.id)).toBe(false);
  expect((await request(`/storage/volumes/${pool.id}`)).status).toBe(404);
  expect(db.volumes.some((item) => item.id === pool.id && !item.deletedAt)).toBe(true);
});

it("keeps file-system NFS access scoped to its project and VPC", async () => {
  const vpc = db.network.vpcs.find((item) => item.projectId === db.projects[0].id && item.region === "jp" && item.networkType !== "baremetal")!;
  const subnet = db.network.subnets.find((item) => item.vpcId === vpc.id)!;
  const access = { protocol: "nfs4.1", vpcId: vpc.id, subnetId: subnet.id,
    allowedCidr: subnet.cidr, accessMode: "read_write", rootSquash: true };
  const created = await request("/storage/volumes", "POST", {
    name: "shared-nfs-test", kind: "file", tier: "nas_capacity", sizeGb: 200,
    projectId: db.projects[0].id, region: "jp", fileAccess: access,
  });
  expect(created.status).toBe(201);
  expect(created.data.fileAccess).toEqual(access);
  expect((await request(`/storage/volumes/${created.data.id}/access`, "PATCH", {
    ...access, accessMode: "read_only",
  })).data.fileAccess.accessMode).toBe("read_only");
  expect((await request(`/storage/volumes/${created.data.id}/access`, "PATCH", {
    ...access, allowedCidr: "192.0.2.0/24",
  })).status).toBe(422);
  expect((await request(`/storage/volumes/${created.data.id}/access`, "PATCH", {
    ...access, subnetId: "other-project-subnet",
  })).status).toBe(422);
  expect((await request(`/storage/volumes/${created.data.id}`)).data.fileAccess.accessMode).toBe("read_only");
  const vm = db.resources.find((item) => item.kind === "gpu_vm" && item.projectId === db.projects[0].id && item.region === "jp" && item.status === "running")!;
  expect((await request(`/storage/volumes/${created.data.id}/attach`, "POST", {
    resourceUuid: vm.resourceUuid, mountPath: "/mnt/shared",
  })).status).toBe(422);
  expect(db.volumes.find((item) => item.id === created.data.id)?.resourceUuid).toBeNull();
});

it("links a shared file system through cluster PV/PVC only when node subnets are authorized", async () => {
  const cluster = db.resources.find((item) => item.kind === "vgpu" && item.status === "running" &&
    db.network.vpcs.some((vpc) => vpc.id === item.spec.vpc && vpc.networkType !== "baremetal"))!;
  expect(cluster).toBeDefined();
  if (cluster.kind !== "vgpu") throw new Error("Expected cluster");
  const vpc = db.network.vpcs.find((item) => item.id === cluster.spec.vpc)!;
  const subnet = db.network.subnets.find((item) => item.vpcId === vpc.id)!;
  const created = await request("/storage/volumes", "POST", {
    name: "cluster-shared-nfs", kind: "file", tier: "nas_capacity", sizeGb: 200,
    projectId: cluster.projectId, region: cluster.region,
    fileAccess: { protocol: "nfs4.1", vpcId: vpc.id, subnetId: subnet.id,
      allowedCidr: vpc.cidr, accessMode: "read_write", rootSquash: true },
  });
  expect(created.status).toBe(201);
  const linked = await request(`/storage/volumes/${created.data.id}/attach`, "POST", {
    resourceUuid: cluster.resourceUuid, mountPath: "/pvc/default/data",
  });
  expect(linked.status).toBe(200);
  expect(cluster.spec.volumeBindings?.some((item) => item.volumeId === created.data.id)).toBe(true);
  expect((await request(`/storage/volumes/${created.data.id}/access`, "PATCH", {
    ...created.data.fileAccess, allowedCidr: "192.0.2.0/24",
  })).status).toBe(422);
  expect((await request(`/storage/volumes/${created.data.id}/detach`, "POST", {})).status).toBe(200);
  expect(cluster.spec.volumeBindings?.some((item) => item.volumeId === created.data.id)).toBe(false);
});

it("validates volume specs and keeps bucket ceilings separate from regional actual usage", async () => {
  const invalid = await request("/storage/volumes", "POST", {
    name: "invalid-size",
    kind: "block",
    tier: "essd_pl1",
    sizeGb: 45,
    projectId: db.projects[0].id,
    region: "jp",
  });
  expect(invalid.status).toBe(422);
  const object = await request("/buckets", "POST", {
    name: "capacity-overflow-test",
    region: "jp",
    projectId: db.projects[0].id,
    storageClass: "STANDARD",
    quotaGb: 100000,
  });
  expect(object.status).toBe(201);
  const objectQuota = (await request("/quotas?region=jp")).data.find((quota: { metric: string }) => quota.metric === "storage").storageBreakdown.find((item: { kind: string }) => item.kind === "object");
  expect(objectQuota.usedGb).toBeLessThan(100);
});

it("creates object buckets without reserving regional quota and meters actual object bytes", async () => {
  const before = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  const created = await request("/buckets", "POST", {
    name: "lifecycle-demo-bucket",
    region: "jp",
    projectId: db.projects[0].id,
    storageClass: "STANDARD",
    quotaGb: 1000,
  });
  expect(created.status).toBe(201);
  expect(created.data.projectId).toBe(db.projects[0].id);
  expect(
    (await request("/buckets/lifecycle-demo-bucket/lifecycle")).status,
  ).toBe(404);
  const rule = await request(`/buckets/${created.data.id}/lifecycle`, "PUT", {
    rules: [{ prefix: "archive/", action: "infrequent", after_days: 30 }],
  });
  expect(rule.status).toBe(200);
  expect(rule.data).toHaveLength(1);
  const cleared = await request(
    `/buckets/${created.data.id}/lifecycle`,
    "PUT",
    { rules: [] },
  );
  expect(cleared.data).toHaveLength(0);
  const afterCreate = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(afterCreate.usedValue).toBe(before.usedValue);
  const beforeUpload = afterCreate.storageBreakdown.find((item: { kind: string }) => item.kind === "object").usedGb;
  const uploaded = await request(`/buckets/${created.data.id}/objects`, "POST", {
    key: "usage-check.txt", size: 1_000_000, contentType: "text/plain", content: "data:text/plain;base64,eA==",
  });
  expect(uploaded.status).toBe(201);
  const afterUpload = (await request("/quotas?region=jp")).data.find((quota: { metric: string }) => quota.metric === "storage");
  expect(afterUpload.storageBreakdown.find((item: { kind: string }) => item.kind === "object").usedGb).toBeCloseTo(beforeUpload + 0.001);
  const removedObject = await fetch(`http://localhost/api/buckets/${created.data.id}/objects?key=usage-check.txt`, {
    method: "DELETE",
    headers: { "X-Role": "owner" },
  });
  expect(removedObject.status).toBe(204);
  const deleted = await fetch(
    `http://localhost/api/buckets/${created.data.id}`,
    {
      method: "DELETE",
      headers: { "X-Role": "owner" },
    },
  );
  expect(deleted.status).toBe(204);
  const afterDelete = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(afterDelete.usedValue).toBe(before.usedValue);
});

it("applies due object lifecycle rules to matching objects", async () => {
  const bucket = db.buckets.find(
    (item) => item.region === "jp" && item.objects.length > 0,
  );
  expect(bucket).toBeDefined();
  if (!bucket) return;
  const object = bucket.objects[0];
  object.key = "archive/old-item";
  object.updatedAt = new Date(Date.now() - 40 * 86400000).toISOString();
  bucket.lifecycle = [
    {
      prefix: "archive/",
      action: "infrequent",
      after_days: 30,
      nextRun: new Date(Date.now() - 86400000).toISOString(),
    },
  ];
  await request(`/buckets/${bucket.id}/overview`);
  expect(object.storageClass).toBe("IA");
  bucket.lifecycle = [
    {
      prefix: "archive/",
      action: "delete",
      after_days: 30,
      nextRun: new Date(Date.now() - 86400000).toISOString(),
    },
  ];
  const result = await request(`/buckets/${bucket.id}/overview`);
  expect(result.data.objectCount).toBe(bucket.objects.length);
  expect(bucket.objects.some((item) => item.key === "archive/old-item")).toBe(
    false,
  );
});

it("keeps regional storage allocation baselines out of tenant volume APIs", async () => {
  const volume = db.volumes.find(
    (item) => item.id.includes("-allocated-") && item.region === "jp",
  )!;
  const before = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  const listed = await request("/storage/volumes?region=jp");
  expect(listed.data.some((item: { id: string }) => item.id === volume.id)).toBe(false);
  const detail = await request(`/storage/volumes/${volume.id}`);
  expect(detail.status).toBe(404);
  const after = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(after.usedValue).toBe(before.usedValue);
});

it("keeps customer file systems linked to valid projects and compute mounts", async () => {
  const volumes = (await request("/storage/volumes")).data.filter((volume: { kind: string }) => volume.kind === "file");
  expect(volumes.length).toBeGreaterThan(0);
  const products = (await request("/storage/products")).data;
  for (const volume of volumes) {
    expect(db.projects.some((project) => project.id === volume.projectId && !project.deletedAt)).toBe(true);
    expect(products.some((product: { kind: string; tier: string }) => product.kind === "file" && product.tier === volume.tier)).toBe(true);
    if (!volume.resourceUuid) {
      expect(volume.mountPath).toBe("");
      continue;
    }
    const linked = db.resources.find((resource) => resource.resourceUuid === volume.resourceUuid && !resource.deletedAt);
    expect(linked).toBeDefined();
    expect(linked?.projectId).toBe(volume.projectId);
    expect(linked?.region).toBe(volume.region);
    expect(volume.mountPath).toMatch(/^\//);
    if (linked?.kind === "vgpu" && volume.role === "pvc") {
      const pv = clusterView(linked).storage.pvs.find((item) => item.volumeId === volume.id);
      expect(pv?.source).toBe("file");
      expect(clusterView(linked).storage.pvcs.some((item) => item.pvName === pv?.name && item.status === "Bound")).toBe(true);
    }
  }
});

it("meters a standalone file system by configured capacity and shares the catalog price", async () => {
  const product = (await request("/storage/products")).data.find(
    (item: { kind: string; tier: string }) => item.kind === "file" && item.tier === "nas_capacity",
  );
  const created = await request("/storage/volumes", "POST", {
    name: "billing-file-system", kind: "file", tier: "nas_capacity", sizeGb: 200,
    projectId: db.projects[0].id, region: "jp",
  });
  expect(created.status).toBe(201);
  const volume = db.volumes.find((item) => item.id === created.data.id)!;
  volume.createdAt = new Date(Date.now() - 3_600_000).toISOString();
  db.billingCursors[volume.id] = Date.parse(volume.createdAt);
  await request("/billing/report?billing_period=" + new Date().toISOString().slice(0, 7));
  const rows = db.usage.filter((row) => row.resourceUuid === volume.id);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.kind === "storage" && Math.abs(row.unitPrice - product.usdGbMonth / 730) < 1e-8)).toBe(true);
  expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(200 * product.usdGbMonth / 730, 2);
  expect((await request("/storage/products")).data.filter((item: { kind: string }) => item.kind === "object")
    .every((item: { usdGbMonth: number }) => item.usdGbMonth === 0)).toBe(true);
});
