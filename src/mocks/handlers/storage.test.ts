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
});
