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
  expect(overview.distribution).toHaveLength(16);
  expect(
    overview.distribution.reduce(
      (n: number, c: { gpuCount: number }) => n + c.gpuCount,
      0,
    ),
  ).toBe(1040);
  expect(overview).not.toHaveProperty("regions");
  for (const cell of overview.distribution) {
    const rows = db.resources.filter(
      (r) => !r.deletedAt && r.kind === cell.kind && r.region === cell.region,
    );
    expect(cell.gpuCount).toBe(rows.reduce((n, r) => n + r.spec.gpuCount, 0));
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
  ).toBe(8);
});
it("computes host RAM from VM, physical machine, node pool and replica allocations", async () => {
  const quotas = (await request("/quotas")).data;
  expect(quotas).toHaveLength(REGIONS.length * QUOTA_METRICS.length);
  for (const region of REGIONS) {
    const rows = db.resources.filter((r) => r.region === region);
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
  expect(ram).toBeGreaterThan(10000);
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
    if (r.kind === "vgpu") expect(r.spec.storageGb).toBe(r.spec.defaultPvcGb);
  }
});

it("checks peak RAM allocation before admitting an elastic deployment", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("th")[0]);
  if (!("memoryGb" in spec && "quantity" in spec))
    throw new Error("Expected VM");
  spec.memoryGb = 2048;
  spec.subnet = "th-default";
  spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO";
  spec.scaling = { ...defaultScaling("gpu_vm"), max_size: 8 };
  const body = {
    kind: "gpu_vm",
    name: "memory-contract",
    projectId: "default",
    region: "th",
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
