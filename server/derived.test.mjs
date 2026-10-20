import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveResponse } from "./derived.mjs";

const rows = {
  compute: [
    {
      region: "jp",
      project_id: "default",
      kind: "gpu_vm",
      gpu_count: "8",
      vcpu_count: "128",
      memory_gb: "1024",
    },
    {
      region: "sg",
      project_id: "training",
      kind: "vgpu",
      gpu_count: "2",
      vcpu_count: "32",
      memory_gb: "256",
    },
  ],
  storage: [
    { region: "jp", kind: "block", used_gb: "100" },
    { region: "jp", kind: "file", used_gb: "200" },
    { region: "jp", kind: "object", used_gb: "300" },
  ],
  network: [
    { region: "jp", metric: "ip", used_value: "3" },
    { region: "jp", metric: "vpc", used_value: "2" },
  ],
};
const client = {
  async query(sql) {
    if (sql.includes("current_compute_usage")) return { rows: rows.compute };
    if (sql.includes("current_storage_usage")) return { rows: rows.storage };
    if (sql.includes("current_network_usage")) return { rows: rows.network };
    if (sql.includes("billing_usage") && sql.includes("project_id ="))
      return { rows: [{ month: "12.50" }] };
    if (sql.includes("billing_usage"))
      return { rows: [{ month: "20.7550", today: "3.2550", total: "99.5050" }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
const quota = (metric) => ({
  region: "jp",
  metric,
  usedValue: -1,
  limitValue: 1000,
  ...(metric === "storage"
    ? {
        storageBreakdown: [
          { kind: "block", usedGb: -1, limitGb: 400 },
          { kind: "file", usedGb: -1, limitGb: 300 },
          { kind: "object", usedGb: -1, limitGb: 300 },
        ],
      }
    : {}),
});
const response = (data) => Response.json(data);
const request = (path) => new Request(`http://localhost${path}`);

test("quota response comes from PostgreSQL compute, storage and network allocations", async () => {
  const result = await deriveResponse(
    client,
    request("/api/quotas?region=jp"),
    response(["gpu", "vcpu", "memory", "storage", "ip"].map(quota)),
  );
  const data = await result.json();
  assert.deepEqual(
    data.map((item) => item.usedValue),
    [8, 128, 1024, 600, 3],
  );
  assert.deepEqual(
    data[3].storageBreakdown.map((item) => item.usedGb),
    [100, 200, 300],
  );
});

test("overview and project use the same database allocation and billing rows", async () => {
  const overview = await deriveResponse(
    client,
    request("/api/overview"),
    response({
      allocated: -1,
      distribution: [{ region: "jp", kind: "gpu_vm", gpuCount: -1 }],
      quotas: [quota("gpu"), quota("storage")],
    }),
  );
  const current = await overview.json();
  assert.equal(current.allocated, 10);
  assert.equal(current.distribution[0].gpuCount, 8);
  assert.equal(current.quotas[0].usedValue, 8);
  assert.equal(current.month, 20.76);
  assert.equal(current.today, 3.26);
  assert.equal(current.total, 99.51);
  const project = await deriveResponse(
    client,
    request("/api/projects/default/summary"),
    response({ gpuTotal: -1, monthCost: -1, quotas: [quota("gpu")] }),
  );
  const detail = await project.json();
  assert.equal(detail.gpuTotal, 8);
  assert.equal(detail.monthCost, 12.5);
});

test("network usage is recomputed from active database entities", async () => {
  const result = await deriveResponse(
    client,
    request("/api/network/quotas?region=jp"),
    response([
      {
        region: "jp",
        metric: "vpc",
        usedValue: -1,
        limitValue: 10,
        remaining: -1,
      },
      {
        region: "jp",
        metric: "ip",
        usedValue: -1,
        limitValue: 5,
        remaining: -1,
      },
    ]),
  );
  const data = await result.json();
  assert.deepEqual(
    data.map((item) => [item.usedValue, item.remaining]),
    [
      [2, 8],
      [3, 2],
    ],
  );
});
