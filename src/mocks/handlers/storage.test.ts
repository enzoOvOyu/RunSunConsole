import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { defaultSpec, normalizeSpec } from "../../lib/config";
import { poolsFor } from "../fixtures/gpu-specs";
import { estimate } from "../lib/derive";
import { RATES } from "../fixtures/pricing";
import { storageSelectionsSchema } from "../../lib/schema";

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
it("creates multiple volumes and an attached bucket with one deployment order", async () => {
  const before = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  const pool = poolsFor("jp")[0];
  const spec = normalizeSpec({
    ...defaultSpec("gpu_vm", pool),
    storageSelections: selections,
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
  ).toHaveLength(3);
  expect(volumes.map((v: { tier: string }) => v.tier)).toContain(
    "nas_capacity",
  );
  const bucket = db.buckets.find((b) => b.name === "runsun-test-object-bucket");
  expect(bucket?.attachedResourceUuid).toBe(resource.resourceUuid);
  expect(bucket?.quotaGb).toBe(500);
  expect(bucket?.region).toBe("jp");
  expect((await request("/storage/products")).data.length).toBeGreaterThan(5);
  const after = (await request("/quotas?region=jp")).data.find(
    (quota: { metric: string }) => quota.metric === "storage",
  );
  expect(after.usedValue - before.usedValue).toBe(1000);
  expect(after.storageBreakdown).toEqual(
    before.storageBreakdown.map(
      (item: { kind: string; usedGb: number; limitGb: number }) => ({
        ...item,
        usedGb:
          item.usedGb +
          (item.kind === "block"
            ? 300
            : item.kind === "file"
              ? 200
              : item.kind === "object"
                ? 500
                : 0),
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

it("rejects invalid standalone storage sizes and object capacity above the regional quota", async () => {
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
  expect(object.status).toBe(409);
});

it("creates an object bucket, manages lifecycle rules, and releases quota on deletion", async () => {
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
  expect(afterCreate.usedValue).toBe(before.usedValue + 1000);
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
