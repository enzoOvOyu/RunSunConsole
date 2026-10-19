import { it, expect, vi } from "vitest";
import { seedResources } from "./fixtures/resources";
import { GPU_SPECS } from "./fixtures/gpu-specs";
import { metricsFor } from "./metrics";
it("generates deterministic physical metrics with nulls for inactive resources", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
  for (const r of seedResources()) {
    const metrics = metricsFor(r);
    expect(metricsFor(r)).toEqual(metrics);
    const pool = GPU_SPECS[r.nodePool];
    for (const series of metrics) {
      const values = series.points
        .map((p) => p.value)
        .filter((v): v is number => v !== null);
      if (r.status === "stopped" || r.status === "provisioning")
        expect(values).toHaveLength(0);
      if (series.key === "memory_used")
        expect(values.every((v) => v <= pool.memoryGb)).toBe(true);
      if (series.key === "power_draw")
        expect(values.every((v) => v <= pool.tdp * 1.02)).toBe(true);
    }
    if (r.kind === "inference") {
      const p50 = metrics.find((s) => s.key === "ttft_p50")!;
      const p99 = metrics.find((s) => s.key === "ttft_p99")!;
      expect(
        p50.points.every(
          (p, i) => p.value === null || p99.points[i].value! >= p.value,
        ),
      ).toBe(true);
    }
  }
  vi.useRealTimers();
});
it("freezes the last known error metrics", () => {
  const r = seedResources().find((r) => r.status === "error")!;
  vi.useFakeTimers();
  const before = metricsFor(r);
  vi.advanceTimersByTime(3600000);
  expect(metricsFor(r)).toEqual(before);
  vi.useRealTimers();
});
