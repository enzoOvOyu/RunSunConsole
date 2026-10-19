import type { Resource, MetricSeries } from "../types/domain";
import { rng } from "./lib/rng";
import { GPU_SPECS } from "./fixtures/gpu-specs";
export function metricsFor(
  r: Resource,
  window = "1h",
  fault = "",
): MetricSeries[] {
  const windowMs =
    window === "7d"
      ? 7 * 86400000
      : window === "24h"
        ? 86400000
        : window === "6h"
          ? 21600000
          : 3600000;
  const bucket =
    window === "7d"
      ? 3600000
      : window === "24h"
        ? 300000
        : window === "6h"
          ? 60000
          : 10000;
  const end =
    Math.floor(
      (r.status === "error"
        ? new Date(r.stoppedAt || r.createdAt).getTime()
        : Date.now()) / bucket,
    ) * bucket;
  const count = Math.ceil(windowMs / bucket) + 1;
  const gpu = GPU_SPECS[r.nodePool];
  const random = rng(`${r.region}:${r.resourceUuid}:${window}:${end}`);
  const defs: [string, string, number, number | null][] = [
    ["gpu_utilization", "%", 74, 95],
    ["memory_used", "GB", gpu.memoryGb * 0.72, gpu.memoryGb * 0.92],
    ["power_draw", "W", gpu.tdp * 0.74, gpu.tdp],
    ["temperature", "°C", 68, 85],
    ["cpu_utilization", "%", fault === "straggler" ? 94 : 43, 90],
    ["network_mbps", "MB/s", fault === "network" ? 24 : 440, 1500],
  ];
  if (r.kind === "gpu_baremetal")
    defs.push(
      ["ecc_dbe", "", fault === "xid48" ? 2 : 0, 1],
      ["pcie_link_width", "", 16, null],
      ["ib_symbol_errors", "", 2, 10],
      ["nvme_temperature", "°C", 44, 70],
    );
  if (r.kind === "vgpu")
    defs.push(
      ["apiserver_latency_p99", "ms", 184, 1000],
      ["etcd_fsync_p99", "ms", 8, 25],
    );
  if (r.kind === "inference")
    defs.push(
      ["ttft_p50", "ms", 320, 2000],
      ["ttft_p99", "ms", 840, 5000],
      ["tpot_p99", "ms", 48, 100],
      ["requests_waiting", "", fault === "insufficient" ? 68 : 18, 50],
      ["requests_per_second", "req/s", 6.8, 30],
      ["kv_cache_usage", "%", fault === "oom" ? 96 : 76, 92],
    );
  return defs.map(([key, unit, base, threshold]) => ({
    key,
    unit,
    threshold,
    points: Array.from({ length: count }, (_, i) => {
      const at = new Date(
        end - windowMs + (i * windowMs) / (count - 1),
      ).toISOString();
      if (
        (r.spec.gpuCount === 0 &&
          [
            "gpu_utilization",
            "memory_used",
            "power_draw",
            "temperature",
          ].includes(key)) ||
        new Date(at).getTime() < new Date(r.createdAt).getTime() ||
        r.status === "stopped" ||
        r.status === "provisioning" ||
        r.status === "terminating" ||
        r.deletedAt
      )
        return { at, value: null };
      const wave =
        Math.sin(i / 12 + (r.region === "jp" ? 1 : 2)) * 0.08 +
        (random() - 0.5) * 0.09;
      const value = ["ecc_dbe", "pcie_link_width", "ib_symbol_errors"].includes(
        key,
      )
        ? base
        : base * (1 + wave + (i % 53 === 0 ? 0.09 : 0));
      return {
        at,
        value:
          Math.round(
            Math.min(
              key === "memory_used"
                ? gpu.memoryGb
                : key === "power_draw"
                  ? gpu.tdp
                  : key.includes("utilization") || key === "kv_cache_usage"
                    ? 100
                    : Infinity,
              value,
            ) * 10,
          ) / 10,
      };
    }),
  }));
}
