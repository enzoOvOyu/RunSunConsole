import { it, expect } from "vitest";
import { date, duration } from "./date";
it("handles nullable dates and elapsed durations", () => {
  expect(date(null)).toBe("—");
  expect(date("2026-10-17T06:00:00Z")).toContain("2026");
  expect(duration(3661)).toBe("1h 1m");
});
