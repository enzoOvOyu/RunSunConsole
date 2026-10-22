import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { RATES } from "../fixtures/pricing";
import { defaultSpec, defaultScaling } from "../../lib/config";
import { poolsFor } from "../fixtures/gpu-specs";
import { metricsFor } from "../metrics";
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  role = "owner",
  headers: Record<string, string> = {},
) {
  const r = await fetch("http://localhost/api" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Role": role, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}
it("filters regions and retains allocated GPU aggregate", async () => {
  const jp = await request("/resources?region=jp&size=1000");
  const us = await request("/resources?region=us&size=1000");
  expect(
    jp.data.items.every((r: { region: string }) => r.region === "jp"),
  ).toBe(true);
  expect(
    jp.data.items.map((r: { resourceUuid: string }) => r.resourceUuid),
  ).not.toEqual(
    us.data.items.map((r: { resourceUuid: string }) => r.resourceUuid),
  );
  expect((await request("/overview")).data.allocated).toBe(
    db.resources.reduce(
      (sum, resource) =>
        sum +
        (["running", "provisioning"].includes(resource.status)
          ? resource.spec.gpuCount
          : 0),
      0,
    ),
  );
  expect((await request("/resources?region=th")).status).toBe(422);
  expect(db.resources.every((r) => r.region !== ("th" as string))).toBe(true);
});
it("enforces role, confirmation, dependencies and history for deletion", async () => {
  const r = db.resources.find(
    (r) => r.kind === "gpu_vm" && r.status === "stopped",
  )!;
  expect(
    (
      await request(
        `/resources/${r.resourceUuid}?confirm=${r.displayId}`,
        "DELETE",
        undefined,
        "viewer",
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(`/resources/${r.resourceUuid}?confirm=wrong`, "DELETE")).data
      .code,
  ).toBe("CONFIRM_MISMATCH");
  expect(
    (
      await request(
        `/resources/${r.resourceUuid}?confirm=${r.displayId}`,
        "DELETE",
      )
    ).status,
  ).toBe(200);
  expect(r.deletedAt).not.toBeNull();
  expect((await request(`/resources/${r.resourceUuid}`)).status).toBe(410);
  expect(
    (
      await request(
        `/resources/${r.resourceUuid}?confirm=${r.displayId}`,
        "DELETE",
      )
    ).data.code,
  ).toBe("ALREADY_DELETED");
  const hosted = db.notebooks[0];
  const host = db.resources.find(
    (r) => r.resourceUuid === hosted.resourceUuid,
  )!;
  expect(
    (
      await request(
        `/resources/${host.resourceUuid}?confirm=${host.displayId}`,
        "DELETE",
      )
    ).data.code,
  ).toBe("HAS_DEPENDENCIES");
});
it("stops compute, releases compute quota, and returns null metrics", async () => {
  const r = db.resources[0];
  const before = (await request("/quotas?region=jp")).data.find(
    (q: { metric: string }) => q.metric === "gpu",
  ).usedValue;
  expect(
    (await request(`/resources/${r.resourceUuid}/stop`, "POST", {})).status,
  ).toBe(200);
  const after = (await request("/quotas?region=jp")).data.find(
    (q: { metric: string }) => q.metric === "gpu",
  ).usedValue;
  expect(before - after).toBe(r.spec.gpuCount);
  expect(
    metricsFor(r).every((s) => s.points.every((p) => p.value === null)),
  ).toBe(true);
  expect(
    (await request(`/resources/${r.resourceUuid}/start`, "POST", {})).status,
  ).toBe(200);
});
it("rejects unavailable pools, impossible model VRAM and maximum scaling quota", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("jp")[0]);
  if ("sshPubkey" in spec)
    spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO";
  const base = {
    kind: "gpu_vm",
    name: "contract-test",
    projectId: "default",
    region: "jp",
    mode: "on_demand",
    labels: [],
    nodePool: "GB300_NVL72",
    spec,
  };
  expect((await request("/deployment-orders", "POST", base)).data.code).toBe(
    "INSUFFICIENT_CAPACITY",
  );
  const inference = defaultSpec("inference", poolsFor("jp")[0]);
  if ("modelRef" in inference) {
    inference.modelRef = "llama70";
    inference.quantization = "bf16";
  }
  expect(
    (
      await request("/deployment-orders", "POST", {
        ...base,
        kind: "inference",
        nodePool: "H100_SXM",
        spec: inference,
      })
    ).data.code,
  ).toBe("MODEL_MEMORY_EXCEEDED");
  spec.scaling = { ...defaultScaling("gpu_vm"), max_size: 64 };
  if ("gpuPerInstance" in spec) {
    spec.gpuPerInstance = 8;
    spec.gpuCount = 8;
  }
  expect(
    (
      await request("/deployment-orders", "POST", {
        ...base,
        nodePool: "H100_SXM",
        spec,
      })
    ).status,
  ).toBe(409);
});
it("rejects inference precision variants unsupported by the selected GPU", async () => {
  const spec = defaultSpec("inference", poolsFor("jp")[0]);
  if (!("quantization" in spec)) throw Error("fixture");
  spec.quantization = "fp4";
  const result = await request("/deployment-orders", "POST", {
    kind: "inference",
    name: "invalid-precision",
    projectId: "default",
    region: "jp",
    nodePool: "H100_SXM",
    mode: "on_demand",
    labels: [],
    spec,
  });
  expect(result.status).toBe(422);
  expect(result.data.code).toBe("UNSUPPORTED_PRECISION");
});

it("creates an order and materializes one matching policy", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("sg")[0]);
  if ("subnet" in spec) spec.subnet = "sg-default";
  if ("sshPubkey" in spec)
    spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO";
  spec.scaling = defaultScaling("gpu_vm");
  const result = await request("/deployment-orders", "POST", {
    kind: "gpu_vm",
    name: "contract-server",
    projectId: "default",
    region: "sg",
    nodePool: "H100_SXM",
    mode: "on_demand",
    labels: [],
    spec,
  });
  expect(result.status).toBe(201);
  expect(result.data.order.projectId).toBe("default");
  expect(
    db.policies.filter(
      (p) => p.resourceUuid === result.data.resource.resourceUuid,
    ),
  ).toHaveLength(1);
  expect(
    result.data.order.price_snapshot.lines.every((l: { unitPrice: number }) =>
      RATES.some(
        (r) => r.region === "sg" && Math.abs(r.unitPrice - l.unitPrice) < 1e-9,
      ),
    ),
  ).toBe(true);
});
it("protects organization entities and scaling policy uniqueness", async () => {
  expect((await request("/projects/default", "DELETE")).data.code).toBe(
    "DEFAULT_PROJECT",
  );
  expect((await request("/projects/training", "DELETE")).data.code).toBe(
    "PROJECT_HAS_RESOURCES",
  );
  expect((await request("/datasets/instructions", "DELETE")).data.code).toBe(
    "DATASET_IN_USE",
  );
  const policy = db.policies[0];
  expect(
    (
      await request("/scaling/policies", "POST", {
        resourceUuid: policy.resourceUuid,
        config: policy.config,
      })
    ).data.code,
  ).toBe("POLICY_EXISTS");
  expect(
    (await request("/scaling/policies/" + policy.id, "DELETE")).data.code,
  ).toBe("POLICY_BOUND_RESOURCE_RUNNING");
});
it("creates projects, updates names and blocks deletion while referenced", async () => {
  const result = await request("/projects", "POST", {
    name: "Evaluation Project",
    slug: "evaluation",
    defaultRegion: "sg",
  });
  expect(result.status).toBe(201);
  expect(result.data.defaultRegion).toBe("sg");
  const id = result.data.id;
  const singaporeProjects = (await request("/projects?region=sg")).data;
  const japanProjects = (await request("/projects?region=jp")).data;
  expect(
    singaporeProjects.map((project: { id: string }) => project.id),
  ).toContain(id);
  expect(japanProjects.map((project: { id: string }) => project.id)).not.toContain(id);
  expect(
    (await request("/projects/" + id, "PATCH", { name: "Evaluation Updated" }))
      .data.name,
  ).toBe("Evaluation Updated");
  expect((await request("/projects/" + id, "DELETE")).status).toBe(204);
  expect(
    (await request("/projects/default", "PATCH", { name: "wrong" }, "member"))
      .status,
  ).toBe(403);
});
it("keeps project cost trends scoped to that project", async () => {
  const summary = (await request("/projects/production/summary")).data;
  const expected = db.usage
    .filter(
      (u) =>
        u.projectId === "production" &&
        u.usageHour.startsWith(new Date().toISOString().slice(0, 7)),
    )
    .reduce((a, u) => a + u.amount, 0);
  expect(summary.monthCost).toBeCloseTo(expected, 1);
  const day = summary.costTrend7d.at(-2).date;
  const dayCost = db.usage
    .filter((u) => u.projectId === "production" && u.usageHour.startsWith(day))
    .reduce((a, u) => a + u.amount, 0);
  expect(summary.costTrend7d.at(-2).amount).toBeCloseTo(dayCost, 1);
});
it("isolates object prefixes and uploads, signs and deletes content", async () => {
  const before = (await request("/buckets/bucket-jp/objects?prefix=models/"))
    .data;
  expect(before.prefixes).toEqual(["models/llama/"]);
  expect(before.objects).toHaveLength(0);
  const uploaded = await request("/buckets/bucket-jp/objects", "POST", {
    key: "tests/file.txt",
    size: 5,
    contentType: "text/plain",
    content: "data:text/plain;base64,aGVsbG8=",
  });
  expect(uploaded.status).toBe(201);
  expect(
    (await request("/buckets/bucket-jp/sign?key=tests%2Ffile.txt&expires=60"))
      .data.url,
  ).toBe("data:text/plain;base64,aGVsbG8=");
  expect(
    (await request("/buckets/bucket-jp/objects?key=tests%2Ffile.txt", "DELETE"))
      .status,
  ).toBe(204);
  expect(
    (await request("/buckets/bucket-jp/sign?key=tests%2Ffile.txt")).status,
  ).toBe(404);
});
it("filters buckets by region and validates lifecycle bounds", async () => {
  expect(
    (await request("/buckets?region=sg")).data.every(
      (b: { region: string }) => b.region === "sg",
    ),
  ).toBe(true);
  const ok = await fetch("http://localhost/api/buckets/bucket-jp/lifecycle", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: [{ prefix: "logs/", action: "delete", after_days: 30 }],
    }),
  });
  expect(ok.status).toBe(200);
  const bad = await fetch("http://localhost/api/buckets/bucket-jp/lifecycle", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: [{ prefix: "logs/", action: "delete", after_days: 0 }],
    }),
  });
  expect(bad.status).toBe(422);
});
it("creates dataset previews, versions and checks references", async () => {
  const dataset = (
    await request("/datasets", "POST", {
      name: "Evaluation dataset",
      size_gb: 1.2,
      format_tag: "jsonl",
      preview: [{ text: "hello", tokens: 1 }],
    })
  ).data;
  expect(dataset.preview).toEqual([{ text: "hello", tokens: 1 }]);
  const updated = (
    await request("/datasets/" + dataset.id + "/versions", "POST", {
      version: "v1.1",
      size_gb: 2.4,
      note: "expanded",
    })
  ).data;
  expect(updated.latest_version).toBe("v1.1");
  expect(updated.versions).toHaveLength(2);
  expect((await request("/datasets/" + dataset.id, "DELETE")).status).toBe(204);
});
it("uses distinct scaling models and disallows zero warm floor for machines", async () => {
  const r = db.resources.find(
    (r) => r.kind === "gpu_baremetal" && r.status === "running",
  )!;
  const config = {
    ...defaultScaling("gpu_baremetal"),
    min_size: 0,
    scale_to_zero: true,
    max_size: 16,
  };
  expect(
    (
      await request("/scaling/policies", "POST", {
        resourceUuid: r.resourceUuid,
        config,
      })
    ).status,
  ).toBe(422);
  const wrong = { ...defaultScaling("inference"), max_size: 16 };
  expect(
    (
      await request("/scaling/policies", "POST", {
        resourceUuid: r.resourceUuid,
        config: wrong,
      })
    ).status,
  ).toBe(422);
});
it("uses immutable regional rate rows and honors discounts", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("jp")[0]);
  const base = {
    kind: "gpu_vm",
    region: "jp",
    nodePool: "H100_SXM",
    spec,
    mode: "on_demand",
  };
  const standard = (await request("/deployment-orders/estimate", "POST", base))
    .data;
  const spot = (
    await request("/deployment-orders/estimate", "POST", {
      ...base,
      mode: "spot",
    })
  ).data;
  expect(spot.lines[0].unitPrice / standard.lines[0].unitPrice).toBeCloseTo(
    0.55,
  );
  expect(
    spot.lines.find((l: { key: string }) => l.key === "storage").unitPrice,
  ).toBe(
    standard.lines.find((l: { key: string }) => l.key === "storage").unitPrice,
  );
});
it("does not permit a peak lower than requested current size", async () => {
  const r = db.resources.find((r) => r.kind === "gpu_baremetal")!;
  const config = {
    ...defaultScaling("gpu_baremetal"),
    min_size: 1,
    max_size: 2,
  };
  expect(
    (
      await request("/scaling/policies", "POST", {
        resourceUuid: r.resourceUuid,
        config,
      })
    ).data.code,
  ).toBe("VALIDATION_ERROR");
});
it("creates notebook attachments and deleting one keeps its host", async () => {
  const host = db.resources[0];
  const n = (
    await request("/workbench/notebooks", "POST", {
      resourceUuid: host.resourceUuid,
      ide: "jupyter",
      imageRef: "jupyter",
      storageGb: 10,
      autoShutdownIdleMin: 60,
    })
  ).data;
  expect((await request("/workbench/notebooks/" + n.id, "DELETE")).status).toBe(
    204,
  );
  expect(
    db.resources.find((r) => r.resourceUuid === host.resourceUuid)?.deletedAt,
  ).toBeNull();
});
it("creates pipeline runs and rejects cyclic DAG changes", async () => {
  const result = await request("/pipelines/cleaning/runs", "POST", {});
  expect(result.status).toBe(201);
  expect(result.data.status).toBe("running");
  const cyclic = [
    {
      id: "a",
      name: "A",
      type: "source",
      inputs: ["b"],
      parameters: { dataset: "instructions" },
    },
    { id: "b", name: "B", type: "process", inputs: ["a"], parameters: {} },
  ];
  expect(
    (await request("/pipelines/cleaning", "PATCH", { nodes: cyclic })).status,
  ).toBe(422);
  expect(db.pipelines[0].nodes[0].id).toBe("source");
});

it("replays password orders without storing credentials or allocating twice", async () => {
  const spec = defaultSpec("gpu_vm", poolsFor("sg")[0]);
  if (!("authMethod" in spec)) throw new Error("Expected server spec");
  spec.authMethod = "password";
  spec.sshPubkey = "";
  spec.subnet = "sg-default";
  const secret = "Temporary-Secret-42";
  const body = {
    kind: "gpu_vm",
    name: "password-order",
    projectId: "default",
    region: "sg",
    nodePool: "H100_SXM",
    mode: "on_demand",
    labels: [],
    spec,
    authPassword: secret,
  };
  const count = db.resources.length;
  const first = await request("/deployment-orders", "POST", body, "owner", {
    "Idempotency-Key": "password-contract",
  });
  expect(first.status).toBe(201);
  const second = await request("/deployment-orders", "POST", body, "owner", {
    "Idempotency-Key": "password-contract",
  });
  expect(second.status).toBeLessThan(300);
  expect(second.data.resource.resourceUuid).toBe(
    first.data.resource.resourceUuid,
  );
  expect(db.resources).toHaveLength(count + 1);
  expect(JSON.stringify(db)).not.toContain(secret);
});
it("returns kind-specific hardware, cluster and replica diagnostics", async () => {
  const bm = db.resources.find(
    (r) => r.kind === "gpu_baremetal" && r.status === "running",
  )!;
  const vg = db.resources.find(
    (r) => r.kind === "vgpu" && r.status === "running",
  )!;
  const inf = db.resources.find(
    (r) => r.kind === "inference" && r.status === "running",
  )!;
  const hardware = await request(
    `/metrics/${bm.kind}/${bm.resourceUuid}/hardware`,
  );
  expect(hardware.status).toBe(200);
  expect(hardware.data.disks).toHaveLength(8);
  expect(hardware.data.bmc).toHaveProperty("firmware");
  const cluster = await request(
    `/metrics/${vg.kind}/${vg.resourceUuid}/cluster`,
  );
  expect(cluster.status).toBe(200);
  expect(
    cluster.data.nodes.every((n: { name: string }) =>
      n.name.startsWith(vg.displayId),
    ),
  ).toBe(true);
  const replicas = await request(
    `/metrics/${inf.kind}/${inf.resourceUuid}/replicas`,
  );
  expect(replicas.status).toBe(200);
  expect(replicas.data.requestCount).toBe(
    replicas.data.successCount + replicas.data.failedCount,
  );
  expect(
    (await request(`/metrics/${vg.kind}/${vg.resourceUuid}/hardware`)).status,
  ).toBe(404);
});
it("archives projects while retaining historical references", async () => {
  const p = (
    await request("/projects", "POST", {
      name: "Historical project",
      slug: "historical",
    })
  ).data;
  expect((await request(`/projects/${p.id}`, "DELETE")).status).toBe(204);
  expect(db.projects.find((x) => x.id === p.id)?.deletedAt).toBeTruthy();
  expect(
    (await request("/projects")).data.some(
      (x: { id: string }) => x.id === p.id,
    ),
  ).toBe(false);
  expect(
    (await request(`/projects/${p.id}`, "PATCH", { name: "changed" })).status,
  ).toBe(410);
});

it("applies the overdue grace period and preserves metering uniqueness", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const now = Date.now();
    const target = db.resources.find(
      (r) => r.kind === "gpu_vm" && r.status === "running",
    )!;
    db.account.creditBalance = -100;
    db.account.depletedAt = new Date(now - 25 * 3600000).toISOString();
    await request("/overview");
    expect(target.status).toBe("stopped");
    expect(target.deletedAt).toBeNull();
    vi.setSystemTime(new Date(now + 8 * 86400000));
    await request("/overview");
    expect(target.deletedAt).toBeTruthy();
    expect(target.status).toBe("terminating");
    const keys = db.usage.map(
      (u) => `${u.resourceUuid}:${u.usageHour}:${u.unit}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  } finally {
    vi.useRealTimers();
  }
});
it("targets Kubernetes node scheduling operations and records recoverable events", async () => {
  const cluster = db.resources.find((item) => item.kind === "vgpu" && !item.deletedAt)!;
  cluster.status = "running";
  if (cluster.kind !== "vgpu") throw new Error("Expected Kubernetes cluster");
  const initial = (await request(`/metrics/vgpu/${cluster.resourceUuid}/cluster`)).data;
  const nodeUuid = initial.nodes[0].nodeUuid;

  expect((await request(`/resources/${cluster.resourceUuid}/cordon`, "POST", { nodeUuid })).status).toBe(200);
  const cordoned = (await request(`/metrics/vgpu/${cluster.resourceUuid}/cluster`)).data;
  expect(cordoned.nodes.find((node: { nodeUuid: string }) => node.nodeUuid === nodeUuid).state).toBe("unschedulable");
  expect(cordoned.workloads.flatMap((workload: { pods: { nodeUuid: string | null; phase: string }[] }) => workload.pods).some((pod: { nodeUuid: string | null; phase: string }) => pod.phase === "Pending" || pod.nodeUuid !== nodeUuid)).toBe(true);
  expect(db.events[0]).toMatchObject({ type: "NODE_CORDONED", reason: nodeUuid, action: "NODE_CORDONED" });

  expect((await request(`/resources/${cluster.resourceUuid}/uncordon`, "POST", { nodeUuid })).status).toBe(200);
  const resumed = (await request(`/metrics/vgpu/${cluster.resourceUuid}/cluster`)).data;
  expect(resumed.nodes.find((node: { nodeUuid: string }) => node.nodeUuid === nodeUuid).state).toBe("ready");
  expect(db.events[0]).toMatchObject({ type: "NODE_UNCORDONED", reason: nodeUuid, action: "NODE_UNCORDONED" });

  expect((await request(`/resources/${cluster.resourceUuid}/cordon`, "POST", {})).status).toBe(422);
  expect((await request(`/resources/${cluster.resourceUuid}/upgrade`, "POST", { version: "1.31" })).status).toBe(404);
});

it("advances each resource kind from provisioning at its configured deadline", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const startedAt = new Date("2026-10-22T00:00:00.000Z");
    for (const [kind, seconds] of [
      ["gpu_vm", 30],
      ["gpu_baremetal", 180],
      ["vgpu", 120],
      ["inference", 60],
    ] as const) {
      vi.setSystemTime(startedAt);
      Object.assign(db, makeDatabase());
      const resource = db.resources.find(
        (item) => item.kind === kind && item.status === "running",
      );
      expect(resource).toBeDefined();
      if (!resource) continue;
      db.resources = [resource];
      resource.status = "provisioning";
      resource.createdAt = startedAt.toISOString();
      resource.provisioningSince = startedAt.toISOString();
      resource.runningSince = null;
      db.billingCursors[resource.resourceUuid] = startedAt.getTime();
      vi.setSystemTime(new Date(startedAt.getTime() + seconds * 1000 - 1));
      await request("/account");
      expect(resource.status).toBe("provisioning");
      vi.setSystemTime(new Date(startedAt.getTime() + seconds * 1000));
      await request("/account");
      expect(resource.status).toBe("running");
      expect(resource.runningSince).toBe(new Date().toISOString());
      expect(
        db.events.some(
          (event) =>
            event.resourceUuid === resource.resourceUuid &&
            event.before === "provisioning" &&
            event.after === "running",
        ),
      ).toBe(true);
    }
  } finally {
    vi.useRealTimers();
  }
});

it("accepts all four resource types as orders with matching initial state", async () => {
  for (const kind of ["gpu_vm", "gpu_baremetal", "vgpu", "inference"] as const) {
    Object.assign(db, makeDatabase());
    const template = db.resources.find(
      (item) =>
        item.kind === kind && item.status === "running",
    );
    expect(template).toBeDefined();
    if (!template) continue;
    const result = await request("/deployment-orders", "POST", {
      kind,
      name: `creation-check-${kind}`,
      projectId: template.projectId,
      region: template.region,
      mode: "on_demand",
      labels: [],
      nodePool: template.nodePool,
      spec: structuredClone(template.spec),
    });
    expect(result.status).toBe(201);
    expect(result.data.resource.status).toBe("provisioning");
    expect(result.data.order.status).toBe("provisioning");
    expect(result.data.order.resourceUuid).toBe(result.data.resource.resourceUuid);
  }
});
