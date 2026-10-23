import { expect, it, vi } from "vitest";
import { makeDatabase, normalizeDisplayIds, restoreDatabase } from "./database";
import { MODELS } from "../fixtures/content";

it("resumes legacy error resources once without masking later failures", () => {
  const key = "rs.mock.database.v2";
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  });
  try {
    const old = makeDatabase();
    const resource = old.resources.find((item) => item.kind === "inference")!;
    resource.status = "error";
    resource.runningSince = null;
    resource.stoppedAt = new Date(Date.now() - 3600000).toISOString();
    const order = old.orders.find(
      (item) => item.resourceUuid === resource.resourceUuid,
    )!;
    order.status = "failed";
    const snapshot = { ...old, usage: [] };
    storage.set(key, JSON.stringify(snapshot));

    const restored = restoreDatabase();
    const resumed = restored.resources.find(
      (item) => item.resourceUuid === resource.resourceUuid,
    )!;
    expect(resumed.status).toBe("running");
    expect(resumed.runningSince).toBeTruthy();
    expect(resumed.stoppedAt).toBeNull();
    expect(restored.billingCursors[resource.resourceUuid]).toBeGreaterThan(0);
    expect(
      restored.orders.find(
        (item) => item.resourceUuid === resource.resourceUuid,
      )?.status,
    ).toBe("completed");
    expect(
      restored.events.find(
        (event) =>
          event.resourceUuid === resource.resourceUuid &&
          event.before === "error" &&
          event.after === "running",
      ),
    ).toBeTruthy();

    storage.set(
      key,
      JSON.stringify({ ...snapshot, resourceStatusMigrationVersion: 1 }),
    );
    expect(
      restoreDatabase().resources.find(
        (item) => item.resourceUuid === resource.resourceUuid,
      )?.status,
    ).toBe("error");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("merges the current model catalog into saved snapshots and keeps favorites", () => {
  const key = "rs.mock.database.v2";
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  });
  try {
    const old = makeDatabase();
    old.models = old.models.slice(0, 4);
    old.models[0].favorite = false;
    storage.set(key, JSON.stringify({ ...old, usage: [] }));

    const restored = restoreDatabase();
    expect(restored.models).toHaveLength(MODELS.length);
    expect(
      restored.models.find((model) => model.id === old.models[0].id)?.favorite,
    ).toBe(false);
    expect(
      restored.models.find((model) => model.id === "catalog-1")?.context,
    ).toBeGreaterThan(0);
    expect(restored.resources).toHaveLength(old.resources.length);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("migrates legacy storage allocations once and preserves later volume deletion", () => {
  const key = "rs.mock.database.v2";
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  });
  try {
    const old = makeDatabase();
    old.volumes = old.volumes.filter(
      (volume) => !volume.id.includes("-allocated-"),
    );
    for (const bucket of old.buckets) {
      bucket.quotaGb = 2048;
      delete bucket.projectId;
    }
    storage.set(key, JSON.stringify({ ...old, usage: [] }));
    const migrated = restoreDatabase();
    expect(migrated.volumes.length).toBeGreaterThan(old.volumes.length);
    expect(
      migrated.buckets.every((bucket) => bucket.projectId === "default"),
    ).toBe(true);
    expect(
      migrated.buckets.find((bucket) => bucket.region === "us")?.quotaGb,
    ).toBe(180_000);
    const removed = migrated.volumes.find((volume) =>
      volume.id.includes("-allocated-"),
    )!;
    const count = migrated.volumes.length;
    storage.set(
      key,
      JSON.stringify({
        ...migrated,
        volumes: migrated.volumes.filter((volume) => volume.id !== removed.id),
        usage: [],
        storageAllocationMigrationVersion: 1,
      }),
    );
    const restored = restoreDatabase();
    expect(restored.volumes).toHaveLength(count - 1);
    expect(restored.volumes.some((volume) => volume.id === removed.id)).toBe(
      false,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});


it("migrates legacy GPU VM and bare metal image references to split OS and runtime selections", () => {
  const key = "rs.mock.database.v2";
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => storage.set(name, value),
  });
  try {
    const old = makeDatabase();
    const vm = old.resources.find((item) => item.kind === "gpu_vm")!;
    if (vm.kind !== "gpu_vm") throw new Error("Expected GPU VM");
    vm.spec.imageRef = "jupyter";
    const machine = old.resources.find((item) => item.kind === "gpu_baremetal")!;
    if (machine.kind !== "gpu_baremetal") throw new Error("Expected bare metal");
    machine.spec.imageRef = "rocky";
    storage.set(key, JSON.stringify({ ...old, usage: [] }));

    const restored = restoreDatabase();
    const restoredVm = restored.resources.find((item) => item.resourceUuid === vm.resourceUuid)!;
    const restoredMachine = restored.resources.find((item) => item.resourceUuid === machine.resourceUuid)!;
    expect(restoredVm.kind === "gpu_vm" && restoredVm.spec.imageRef).toBe("ubuntu-24.04");
    expect(restoredVm.kind === "gpu_vm" && restoredVm.spec.runtimeImageRef).toBe("jupyter-cu130");
    expect(restoredMachine.kind === "gpu_baremetal" && restoredMachine.spec.imageRef).toBe("rocky-9");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("adds secure defaults to persisted Buckets and objects without changing their content", () => {
  const state = makeDatabase();
  const bucket = state.buckets[0];
  delete bucket.blockPublicAccess;
  delete bucket.defaultEncryption;
  delete bucket.versioning;
  delete bucket.tags;
  delete bucket.objects[0].encryption;
  delete bucket.objects[0].tags;
  const originalSize = bucket.objects[0].size;
  expect(normalizeDisplayIds(state)).toBe(true);
  expect(bucket).toMatchObject({ blockPublicAccess: true, defaultEncryption: true, versioning: false, tags: {} });
  expect(bucket.objects[0]).toMatchObject({ encryption: "SSE", tags: {}, size: originalSize });
  expect(normalizeDisplayIds(state)).toBe(false);
});
