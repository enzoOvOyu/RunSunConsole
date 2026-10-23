import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { costPerHour } from "../lib/derive";
import { inferenceEndpoint } from "../../lib/inference-endpoint";
import { RATES } from "../fixtures/pricing";
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => Object.assign(db, makeDatabase()));
const running = () =>
  db.resources.find((r) => r.kind === "inference" && r.status === "running")!;
async function request(
  uuid: string,
  body?: unknown,
  role = "owner",
  action = "governance",
) {
  const response = await fetch(
    `http://localhost/api/resources/${uuid}/${action}`,
    {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Role": role },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  return { status: response.status, data: await response.json() };
}
const settings = { canaryPercent: 17, qpsLimit: 240, timeoutMs: 45000 };
it("returns weighted versions and safe gateway defaults without disclosing credentials", async () => {
  const r = running();
  const result = await request(r.resourceUuid);
  expect(result.status).toBe(200);
  expect(result.data.endpoint).toBe(inferenceEndpoint(r));
  expect(result.data.qpsLimit).toBe(100);
  expect(result.data.timeoutMs).toBe(30000);
  expect(result.data.versions).toHaveLength(2);
  expect(
    result.data.versions.reduce(
      (n: number, v: { trafficPercent: number }) => n + v.trafficPercent,
      0,
    ),
  ).toBe(100);
  expect(result.data).not.toHaveProperty("apiKey");
  expect(result.data).not.toHaveProperty("credential");
  expect(result.data.scalingPolicy?.config.strategy_model).toBe("replica");
});
it("atomically saves governance without changing allocation, billing or scaling configuration", async () => {
  const r = running();
  const initialCost = costPerHour(r, RATES);
  const spec = structuredClone(r.spec);
  const policies = JSON.stringify(db.policies);
  expect(
    (
      await request(r.resourceUuid, {
        ...settings,
        replicas: 99,
        authEnabled: false,
      })
    ).status,
  ).toBe(200);
  const result = await request(r.resourceUuid);
  expect(result.data).toMatchObject(settings);
  expect(
    result.data.versions.map(
      (v: { trafficPercent: number }) => v.trafficPercent,
    ),
  ).toEqual([83, 17]);
  expect(r.spec).toEqual({
    ...spec,
    canaryPercent: 17,
    gateway: { qpsLimit: 240, timeoutMs: 45000 },
  });
  expect(costPerHour(r, RATES)).toBe(initialCost);
  expect(JSON.stringify(db.policies)).toBe(policies);
  const event = db.events.find((e) => e.type === "GOVERNANCE_UPDATED")!;
  expect(event.resourceUuid).toBe(r.resourceUuid);
  expect(JSON.parse(event.after)).toMatchObject(settings);
  expect(event.value).toBe(17);
});
it("rejects invalid percentages, limits and timeouts before changing any settings", async () => {
  const r = running();
  const spec = JSON.stringify(r.spec);
  for (const bad of [
    { canaryPercent: -1 },
    { canaryPercent: 100 },
    { canaryPercent: 0.5 },
    { qpsLimit: 0 },
    { qpsLimit: 100001 },
    { qpsLimit: 2.5 },
    { timeoutMs: 999 },
    { timeoutMs: 300001 },
    { timeoutMs: 1000.5 },
  ]) {
    expect(
      (await request(r.resourceUuid, { ...settings, ...bad })).status,
    ).toBe(422);
    expect(JSON.stringify(r.spec)).toBe(spec);
  }
});
it("accepts inclusive gateway limits and keeps stable traffic at one percent", async () => {
  const r = running();
  for (const values of [
    { canaryPercent: 0, qpsLimit: 1, timeoutMs: 1000 },
    { canaryPercent: 99, qpsLimit: 100000, timeoutMs: 300000 },
  ]) {
    expect((await request(r.resourceUuid, values)).status).toBe(200);
    expect((await request(r.resourceUuid)).data).toMatchObject(values);
  }
  expect((await request(r.resourceUuid)).data.versions[0].trafficPercent).toBe(
    1,
  );
});
it("allows resource writers and protects both mutation paths from read-only roles", async () => {
  const r = running();
  for (const role of ["owner", "admin", "member"])
    expect((await request(r.resourceUuid, settings, role)).status).toBe(200);
  for (const role of ["viewer", "billing"]) {
    expect((await request(r.resourceUuid, undefined, role)).status).toBe(200);
    expect((await request(r.resourceUuid, settings, role)).status).toBe(403);
    expect(
      (await request(r.resourceUuid, { percent: 35 }, role, "traffic")).status,
    ).toBe(403);
  }
});
it("shows stopped and released settings for history while blocking mutations", async () => {
  const r = running();
  r.status = "stopped";
  r.runningSince = null;
  r.stoppedAt = new Date().toISOString();
  expect((await request(r.resourceUuid)).data.active).toBe(false);
  expect((await request(r.resourceUuid, settings)).data.code).toBe(
    "INVALID_STATE",
  );
  expect(
    (await request(r.resourceUuid, { percent: 5 }, "owner", "traffic")).data
      .code,
  ).toBe("INVALID_STATE");
  r.deletedAt = new Date().toISOString();
  r.status = "terminating";
  expect((await request(r.resourceUuid)).data.active).toBe(false);
  expect((await request(r.resourceUuid, settings)).status).toBe(410);
});
it("does not expose inference governance on other resource kinds", async () => {
  const r = db.resources.find((r) => r.kind === "gpu_vm")!;
  expect((await request(r.resourceUuid)).status).toBe(404);
  expect((await request(r.resourceUuid, settings)).status).toBe(404);
});
it("validates legacy traffic updates with the same bounds and records the configuration change", async () => {
  const r = running();
  expect(
    (await request(r.resourceUuid, { percent: 100 }, "owner", "traffic"))
      .status,
  ).toBe(422);
  expect(
    (await request(r.resourceUuid, { percent: 22 }, "owner", "traffic")).status,
  ).toBe(200);
  expect((await request(r.resourceUuid)).data.canaryPercent).toBe(22);
  expect(db.events[0]).toMatchObject({
    type: "GOVERNANCE_UPDATED",
    metric: "canary_percent",
    value: 22,
  });
});
