import { describe, it, expect } from "vitest";
import { KINDS } from "../types/domain";
import { KIND_META, displayId, formatResourceId } from "./ids";
describe("resource identifiers", () => {
  it("uses one canonical route and prefix per kind", () => {
    expect(new Set(KINDS.map((k) => KIND_META[k].routeKey)).size).toBe(4);
    for (const kind of KINDS)
      expect(displayId(kind, "8a9d0026-1017-4000-8000-000000000012")).toMatch(
        new RegExp(`^${KIND_META[kind].prefix}[a-f0-9]{16}$`),
      );
  });
  it("derives distinct bodies for UUIDs sharing a prefix", () => {
    const first = "8a9d0026-1017-4000-8000-000000000001";
    const second = "8a9d0026-1017-4000-8000-000000000002";
    expect(formatResourceId("gvm", first)).not.toBe(formatResourceId("gvm", second));
    expect(formatResourceId("gvm", first)).toMatch(/^gvm-[a-f0-9]{16}$/);
  });
  it("keeps every visible identifier stable with a 16-character body", () => {
    const source = "8a9d0026-1017-4000-8000-000000000012";
    for (const type of ["prj", "tkt", "log", "inv", "txn"] as const)
      expect(formatResourceId(type, source)).toMatch(
        new RegExp(`^${type}-[a-f0-9]{16}$`),
      );
    expect(formatResourceId("prj", "default")).not.toBe(
      formatResourceId("prj", "other-project"),
    );
    expect(formatResourceId("vpc", "vpc-bm-default", { baremetalVpc: true })).toMatch(
      /^bmvpc-[a-f0-9]{16}$/,
    );
  });
});
