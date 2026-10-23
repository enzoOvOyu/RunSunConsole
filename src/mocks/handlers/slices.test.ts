import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { defaultSpec, normalizeSpec } from "../../lib/config";
import { poolsFor } from "../fixtures/gpu-specs";
import { SLICE_SKUS, reconcileSliceInventory } from "../fixtures/slices";
import type { VgpuSpec } from "../../types/domain";

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
function sliceOrder(count: number, name: string, sku = SLICE_SKUS[0], region: "jp" | "sg" | "us" = "jp") {
  const project = db.projects.find((item) => item.isDefault)!;
  const vpc = db.network.vpcs.find((item) => item.projectId === project.id && item.region === region && !item.deletedAt && item.networkType === "standard")!;
  const subnet = db.network.subnets.find((item) => item.vpcId === vpc.id && !item.deletedAt)!;
  const spec = normalizeSpec({
    ...defaultSpec("vgpu", poolsFor("jp")[0]) as VgpuSpec,
    deploymentMode: "slice" as const,
    slice: { skuId: sku.id, count }, k8sVersion: sku.k8sVersion, nodePools: [], scaling: null,
    apiServerPublic: false, ingressEnabled: false, rbacDefaultAdmin: false,
    podCidr: "", serviceCidr: "", controlPlaneTier: "standard" as const,
    storageMode: "dynamic_block" as const, storageClass: "ssd", defaultPvcGb: 100,
    localPvGb: 0, securityGroups: [], ports: [], vpc: vpc.id,
    subnet: subnet.id, subnets: [subnet.id],
  });
  return { kind: "vgpu", region, projectId: project.id, name,
    nodePool: sku.poolCode, mode: "on_demand", labels: [], spec };
}
it("reserves slices, charges the slice SKU, and releases stock on deletion", async () => {
  const order = sliceOrder(2, "slice-demo-cluster");
  const stockBefore = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0];
  const created = await request("/deployment-orders", "POST", order);
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  expect(created.data.resource.spec.slice.instanceIds).toHaveLength(2);
  expect(created.data.order.price_snapshot.lines.some((line: { unit: string }) => line.unit === "per_slice_hour")).toBe(true);
  expect(created.data.order.price_snapshot.lines.some((line: { unit: string }) => line.unit === "per_gpu_hour" || line.unit === "per_cluster_hour")).toBe(false);
  const reserved = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0];
  expect(reserved.free).toBe(stockBefore.free - 2);
  expect(reserved.reserved).toBe(stockBefore.reserved + 2);
  expect(db.network.interfaces.some((item) => item.resourceUuid === created.data.resource.resourceUuid)).toBe(false);
  const resource = db.resources.find((item) => item.resourceUuid === created.data.resource.resourceUuid)!;
  resource.provisioningSince = new Date(Date.now() - 121000).toISOString();
  const running = (await request(`/resources/${resource.resourceUuid}`)).data;
  expect(running.status).toBe("running");
  const allocated = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0];
  expect(allocated.reserved).toBe(stockBefore.reserved);
  expect(allocated.allocated).toBe(stockBefore.allocated + 2);
  expect((await request(`/resources/${resource.resourceUuid}/stop`, "POST", {})).status).toBe(200);
  expect((await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0].free).toBe(stockBefore.free);
  expect((await request(`/resources/${resource.resourceUuid}/start`, "POST", {})).status).toBe(200);
  expect((await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0].allocated).toBe(stockBefore.allocated + 2);
  const deleted = await request(`/resources/${created.data.resource.resourceUuid}?confirm=${created.data.resource.displayId}`, "DELETE");
  expect(deleted.status).toBe(200);
  const after = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0];
  expect(after.free).toBe(stockBefore.free);
  expect(after.reserved).toBe(stockBefore.reserved);
});
it("rejects requests larger than the free precreated MIG inventory", async () => {
  const projectId = db.projects.find((item) => item.isDefault)!.id;
  const stock = (await request(`/slices/catalog?region=jp&project_id=${projectId}`)).data[0];
  const order = sliceOrder(stock.free + 1, "slice-stock-exceeded");
  const result = await request("/deployment-orders", "POST", order);
  expect(result.status, JSON.stringify(result.data)).toBe(409);
  expect(db.resources.some((item) => item.name === order.name)).toBe(false);
});
it("returns reserved instances when provisioning fails", async () => {
  const order = sliceOrder(1, "slice-failed-cluster");
  const freeBefore = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0].free;
  const created = await request("/deployment-orders", "POST", order);
  expect(created.status).toBe(201);
  const resource = db.resources.find((item) => item.resourceUuid === created.data.resource.resourceUuid)!;
  resource.status = "error";
  const after = (await request(`/slices/catalog?region=jp&project_id=${order.projectId}`)).data[0];
  expect(after.free).toBe(freeBefore);
  expect(db.orders.find((item) => item.resourceUuid === resource.resourceUuid)?.status).toBe("failed");
});

it("offers a validated profile for every GPU pool and preserves saved allocations", async () => {
  const projectId = db.projects.find((item) => item.isDefault)!.id;
  const catalog = (await request(`/slices/catalog?region=us&project_id=${projectId}`)).data;
  expect(catalog).toHaveLength(poolsFor("us").length);
  for (const pool of poolsFor("us")) {
    const sku = catalog.find((item: { poolCode: string }) => item.poolCode === pool.code);
    expect(sku?.profile).toMatch(/^1g\./);
    expect(sku?.free).toBeGreaterThan(0);
    expect(sku?.hourlyUsd).toBeGreaterThan(0);
  }
  const saved = db.sliceInventory.filter((item) => item.skuId === SLICE_SKUS[0].id);
  saved[0].state = "allocated";
  saved[0].resourceUuid = "existing-resource";
  const merged = reconcileSliceInventory(saved);
  expect(merged.find((item) => item.id === saved[0].id)?.resourceUuid).toBe("existing-resource");
  expect(new Set(merged.map((item) => item.skuId))).toEqual(new Set(SLICE_SKUS.map((sku) => sku.id)));
});

it("creates one slice workspace for each supported GPU model", async () => {
  for (const sku of SLICE_SKUS) {
    const order = sliceOrder(1, `slice-${sku.poolCode.toLowerCase().replaceAll("_", "-")}`, sku, "us");
    const created = await request("/deployment-orders", "POST", order);
    expect(created.status, `${sku.id}: ${JSON.stringify(created.data)}`).toBe(201);
    expect(created.data.resource.spec.slice.profile).toBe(sku.profile);
    expect(created.data.resource.spec.k8sVersion).toBe(sku.k8sVersion);
    expect(created.data.order.price_snapshot.lines.find((line: { unit: string }) => line.unit === "per_slice_hour")?.unitPrice).toBe(sku.hourlyUsd);
  }
});
