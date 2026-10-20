import { beforeEach, expect, it } from "vitest";
import { db, makeDatabase } from "../lib/database";
import { handleMockRequest } from "./index";

beforeEach(() => Object.assign(db, makeDatabase()));

it("serves the same API response without a Service Worker", async () => {
  const response = await handleMockRequest(
    new Request("http://example.com/api/overview", {
      headers: { "X-Role": "owner" },
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).allocated).toBe(1040);
});

it("returns structured validation errors in the direct Mock fallback", async () => {
  const response = await handleMockRequest(
    new Request("http://example.com/api/resources?region=th", {
      headers: { "X-Role": "owner" },
    }),
  );
  expect(response.status).toBe(422);
  expect((await response.json()).code).toBe("VALIDATION_ERROR");
});
