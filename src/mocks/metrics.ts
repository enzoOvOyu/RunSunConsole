import type { Resource, MetricSeries } from "../types/domain";
import { hash, pointNoise } from "./lib/rng";
import { db } from "./lib/database";
import { provisioningSeconds } from "./lib/derive";
import { GPU_SPECS } from "./fixtures/gpu-specs";
import { servingRates } from "./lib/runtime";
export function metricsFor(
  r: Resource,
  window = "1h",
  fault = "",
  nodeIndex?: number,
  options: {
    keys?: readonly string[];
    catalog?: boolean;
    latest?: boolean;
  } = {},
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
  const liquid = ["B200_NVL72", "B300", "GB300_NVL72"].includes(r.nodePool);

  const rates = r.kind === "inference" ? servingRates(r) : null;
  const inferMemory =
    r.kind === "inference" && rates
      ? (rates.memory.weightsGb +
          4 +
          (gpu.memoryGb * r.spec.gpuPerReplica - rates.memory.weightsGb - 4) *
            0.76) /
        r.spec.gpuPerReplica
      : gpu.memoryGb * 0.72;
  const defs: [string, string, number | null, number | null][] = [
    [
      "gpu_utilization",
      "%",
      r.kind === "gpu_vm" ? 37 : r.kind === "inference" ? 56 : 86,
      20,
    ],
    [
      "gpu_memory_used",
      "GB",
      fault === "oom" ? gpu.memoryGb * 0.97 : inferMemory,
      gpu.memoryGb * 0.95,
    ],
    ["gpu_power_draw", "W", gpu.tdp * 0.74, gpu.tdp * 0.98],
    ["gpu_temperature", "°C", liquid ? 65 : 73, 85],
    ["gpu_memory_temperature", "°C", liquid ? 74 : 82, 95],
    ["gpu_memory_util", "%", 76, 95],
    ["hbm_bandwidth_util", "%", r.kind === "inference" ? 82 : 64, null],
    ["fan_speed", "%", liquid ? null : 64, 95],
    ["pcie_throughput", "MB/s", 8800, null],
    [
      "nvlink_throughput",
      "GB/s",
      r.nodePool === "H100_SXM" || r.nodePool === "H200_NVL" ? 680 : 1300,
      null,
    ],
    ["sm_clock", "MHz", 1800, null],
    ["mem_clock", "MHz", 1593, null],
  ];
  if (r.kind === "gpu_vm") {
    for (let i = 1; i < r.spec.gpuPerInstance; i++)
      defs.push(
        ...defs
          .slice(0, 4)
          .map(
            ([key, unit, value, threshold]) =>
              [
                `${key}:${i}`,
                unit,
                value === null ? null : value * (0.98 + (i % 3) * 0.01),
                threshold,
              ] as [string, string, number | null, number | null],
          ),
      );
    defs.push(
      ["cpu_util", "%", fault === "straggler" ? 94 : 43, 90],
      ["host_memory_used", "GB", r.spec.memoryGb * 0.62, r.spec.memoryGb * 0.9],
      ["swap_used", "GB", 0.3, 4],
      ["load_avg_1", "", r.spec.vcpu * 0.35, r.spec.vcpu],
      ["load_avg_5", "", r.spec.vcpu * 0.32, r.spec.vcpu],
      ["load_avg_15", "", r.spec.vcpu * 0.29, r.spec.vcpu],
      ["disk_used", "GB", r.spec.storageGb * 0.4, r.spec.storageGb * 0.9],
      ["disk_read_iops", "IOPS", 12400, 50000],
      ["disk_write_iops", "IOPS", 8700, 50000],
      ["disk_read_bw", "MB/s", 1240, null],
      ["disk_write_bw", "MB/s", 860, null],
      ["disk_latency", "ms", 1.8, 20],
      ["net_in", "MB/s", fault === "network" ? 18 : 440, null],
      ["net_out", "MB/s", fault === "network" ? 14 : 280, null],
      ["net_rx_pps", "pps", 18000, null],
      ["net_tx_pps", "pps", 12400, null],
      ["tcp_retransmit", "%", fault === "network" ? 1.2 : 0.08, 1],
    );
  }
  if (r.kind === "gpu_baremetal")
    defs.push(
      ["ecc_sbe", "", 0, 10],
      ["ecc_dbe", "", fault === "xid48" ? 2 : 0, 1],
      ["row_remap_failed", "", 0, 1],
      ["retired_pages", "", 0, 1],
      ["nvlink_crc", "", 0, 1],
      ["pcie_correctable", "", 0, 1],
      ["pcie_uncorrectable", "", 0, 1],
      ["pcie_link_gen", "", 5, null],
      ["pcie_link_width", "", 16, null],
      ["ib_symbol_errors", "", 0, 10],
      ["nvme_temperature", "°C", 44, 70],
    );
  if (r.kind === "vgpu")
    defs.push(
      ["apiserver_latency_p99", "ms", 184, 1000],
      ["etcd_fsync_p99", "ms", 8, 25],
      ["etcd_db_size", "MB", 384, 8000],
      ["scheduler_pending_pods", "", 1, 10],
      ["controller_queue_depth", "", 4, 100],
      ["api_error_rate", "%", 0.02, 1],
    );
  if (r.kind === "inference" && rates) {
    const p50 = 0.33 + rates.avgGeneration * 0.024;
    const p99 = 2.4 + rates.avgGeneration * 0.048;
    defs.push(
      ["ttft_p50", "ms", 330, 2000],
      ["ttft_p90", "ms", 1100, 4000],
      ["ttft_p99", "ms", 2400, 5000],
      ["tpot_p50", "ms", 24, 80],
      ["tpot_p99", "ms", 48, 100],
      ["e2e_latency_p50", "s", p50, 15],
      ["e2e_latency_p99", "s", p99, 30],
      ["requests_waiting", "", fault === "insufficient" ? 68 : 18, 50],
      ["requests_per_second", "req/s", rates.rps, null],
      [
        "num_requests_running",
        "",
        8 * r.spec.replicas,
        r.spec.maxBatchSize * r.spec.replicas,
      ],
      ["num_requests_swapped", "", fault === "oom" ? 24 : 2, 20],
      ["generation_tokens_total", "tokens/s", rates.tokens, null],
      ["prompt_tokens_total", "tokens/s", rates.rps * 1024, null],
      ["kv_cache_usage", "%", fault === "oom" ? 96 : 76, 92],
      ["prefix_cache_hit_rate", "%", r.spec.prefixCaching ? 64 : 0, 90],
      ["avg_generation_length", "tokens", rates.avgGeneration, null],
      ["active_lora_adapters", "", 0, null],
      ["http_error_rate_4xx", "%", 0.16, 0.5],
      ["http_error_rate_5xx", "%", fault === "oom" ? 1.4 : 0.04, 1],
      ["replica_count", "", r.spec.replicas, null],
      [
        "desired_replicas",
        "",
        r.spec.replicas + (fault === "insufficient" ? 1 : 0),
        null,
      ],
    );
  }
  const selectedDefs = options.keys?.length
    ? defs.filter(([key]) => options.keys!.includes(key))
    : defs;
  if (options.catalog)
    return selectedDefs.map(([key, unit, , threshold]) => ({
      key,
      unit,
      threshold,
      comparison: key.split(":")[0] === "gpu_utilization" ? "below" : "above",
      ...(key.split(":")[0] === "gpu_memory_used"
        ? { capacity: gpu.memoryGb }
        : {}),
      points: [],
    }));
  const discrete = new Set([
    "ecc_sbe",
    "ecc_dbe",
    "row_remap_failed",
    "retired_pages",
    "nvlink_crc",
    "pcie_correctable",
    "pcie_uncorrectable",
    "pcie_link_gen",
    "pcie_link_width",
    "ib_symbol_errors",
    "scheduler_pending_pods",
    "controller_queue_depth",
    "replica_count",
    "desired_replicas",
    "active_lora_adapters",
  ]);
  const inactive =
    ["stopped", "provisioning", "terminating"].includes(r.status) ||
    !!r.deletedAt;
  const readyAt =
    new Date(r.createdAt).getTime() + provisioningSeconds(r, db.models) * 1000;
  const today = new Date(end).toISOString().slice(0, 10);
  const resourceSeed = hash(`${import.meta.env.VITE_MOCK_SEED || 20261017}:${r.resourceUuid}:${nodeIndex ?? "all"}`);
  const workloadPeriod = (19 + resourceSeed % 29) * 60000;
  const slowPeriod = (7 + resourceSeed % 6) * 3600000;
  const workloadPhase = (resourceSeed % 6283) / 1000;
  const sampleCount = options.latest ? 1 : count;
  const times = Array.from({ length: sampleCount }, (_, i) => {
    const ms = end - (sampleCount - 1 - i) * bucket;
    const timestamp = new Date(ms);
    return {
      ms,
      at: timestamp.toISOString(),
      slot: Math.floor(ms / 10000),
      shape:
        Math.sin((ms / workloadPeriod) * 2 * Math.PI + workloadPhase) * 0.095 +
        Math.sin((ms / slowPeriod) * 2 * Math.PI + workloadPhase * 0.7) * 0.075 +
        Math.sin((ms / 86400000) * 2 * Math.PI + workloadPhase) *
          (r.kind === "inference" ? 0.1 : 0.045),
      missing:
        ms < readyAt ||
        (r.mode === "spot" &&
          timestamp.toISOString().slice(0, 10) < today &&
          timestamp.getUTCHours() === 5),
    };
  });
  return selectedDefs.map(([key, unit, base, threshold]) => {
    const name = key.split(":")[0];
    const gpuMetric =
      name.startsWith("gpu_") ||
      [
        "hbm_bandwidth_util",
        "fan_speed",
        "pcie_throughput",
        "nvlink_throughput",
        "sm_clock",
        "mem_clock",
      ].includes(name);
    const missing =
      inactive || base === null || (r.spec.gpuCount === 0 && gpuMetric);
    const seed = hash(
      `${import.meta.env.VITE_MOCK_SEED || 20261017}:${r.region}:${r.resourceUuid}:${nodeIndex == null ? "cluster" : "node-" + nodeIndex}:${key}`,
    );
    const cap =
      name === "gpu_memory_used"
        ? gpu.memoryGb
        : name === "gpu_power_draw"
          ? gpu.tdp
          : unit === "%"
            ? 100
            : Infinity;
    const precision =
      name.startsWith("http_error") || name === "api_error_rate"
        ? 1000
        : ["tokens/s", "W", "°C", "MHz", "IOPS", "pps"].includes(unit)
          ? 1
          : 10;
    return {
      key,
      unit,
      threshold,
      comparison: name === "gpu_utilization" ? "below" : "above",
      ...(name === "gpu_memory_used" ? { capacity: gpu.memoryGb } : {}),
      points: times.map((point) => {
        if (missing || point.missing) return { at: point.at, value: null };
        const metricPeriod = (7 + seed % 13) * 60000;
        const metricPhase = (seed % 6283) / 1000;
        const metricShape = Math.sin((point.ms / metricPeriod) * 2 * Math.PI + metricPhase) * 0.035;
        const value = discrete.has(name)
          ? base!
          : base! * (1 + point.shape + metricShape + (pointNoise(seed, point.slot) - 0.5) * 0.035);
        return {
          at: point.at,
          value:
            Math.round(Math.max(0, Math.min(cap, value)) * precision) /
            precision,
        };
      }),
    } as MetricSeries;
  });
}
