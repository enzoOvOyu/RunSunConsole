import { beforeEach, expect, it } from "vitest";
import { db, makeDatabase } from "../lib/database";
import { handleMockRequest } from "./index";

beforeEach(() => Object.assign(db, makeDatabase()));

it("defers read-triggered metering without losing the elapsed charge", async () => {
  const running = db.resources.find(
    (resource) => resource.status === "running",
  )!;
  db.resources = [running];
  db.network.eips = [];
  const cursor = Date.now() - 60_000;
  db.billingCursors[running.resourceUuid] = cursor;
  const request = () => new Request("http://localhost/api/account");
  expect(
    (await handleMockRequest(request(), { delayMs: 0, settleBilling: false }))
      .status,
  ).toBe(200);
  expect(db.billingCursors[running.resourceUuid]).toBe(cursor);
  expect(
    (await handleMockRequest(request(), { delayMs: 0, settleBilling: true }))
      .status,
  ).toBe(200);
  expect(db.billingCursors[running.resourceUuid]).toBeGreaterThan(cursor);
});
