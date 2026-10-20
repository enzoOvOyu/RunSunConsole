import { expect, it, vi } from "vitest";
import { makeDatabase, restoreDatabase } from "./database";

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
