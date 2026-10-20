import { GPU_SPECS } from "../fixtures/gpu-specs";
import type {
  Resource,
  Rate,
  PriceEstimate,
  PriceLine,
  Kind,
  Region,
  PoolCode,
  BillingMode,
  Model,
} from "../../types/domain";
import { round } from "../../lib/money";
export const discount = (mode: BillingMode) =>
  mode === "spot" ? 0.55 : mode === "reserved" ? 0.7 : 1;
export function estimate(
  input: {
    kind: Kind;
    region: Region;
    nodePool: PoolCode;
    spec: Resource["spec"];
    mode: BillingMode;
  },
  rates: Rate[],
): PriceEstimate {
  const { kind, region, nodePool, spec, mode } = input;
  const find = (unit: Rate["unit"], pool: PoolCode | null = nodePool) => {
    const rate = rates.find(
      (r) =>
        r.region === region &&
        r.unit === unit &&
        r.pool === pool &&
        (pool === null || r.kind === kind),
    );
    if (!rate) throw new Error("RATE_NOT_FOUND");
    return rate.unitPrice;
  };
  const lines: PriceLine[] = [];
  const add = (
    key: string,
    unit: Rate["unit"],
    unitPrice: number,
    quantity: number,
    scales: boolean,
  ) =>
    lines.push({
      key,
      unit,
      unitPrice,
      quantity,
      hourly: unitPrice * quantity,
      scales,
    });
  if (kind === "gpu_baremetal" && "machineCount" in spec)
    add(
      "compute",
      "per_machine_hour",
      find("per_machine_hour") * discount(mode),
      spec.machineCount,
      true,
    );
  else if (kind === "vgpu" && "nodePools" in spec) {
    for (const pool of spec.nodePools)
      add(
        `compute:${pool.poolCode}`,
        "per_gpu_hour",
        find("per_gpu_hour", pool.poolCode) * discount(mode),
        pool.nodeCount * pool.gpuPerNode,
        true,
      );
    add(
      "control",
      "per_cluster_hour",
      find("per_cluster_hour", null),
      spec.controlPlaneTier === "ha" ? 3 : 1,
      false,
    );
  } else
    add(
      "compute",
      "per_gpu_hour",
      find("per_gpu_hour") * discount(mode),
      spec.gpuCount,
      true,
    );
  if (spec.storageGb > 0)
    add(
      "storage",
      "per_gb_hour",
      find("per_gb_hour", null),
      spec.storageGb,
      false,
    );
  if (spec.publicIp)
    add(
      "ip",
      "per_ip_hour",
      find("per_ip_hour", null),
      "quantity" in spec ? spec.quantity : 1,
      true,
    );
  const hourly = round(
    lines.reduce((a, l) => a + l.hourly, 0),
    6,
  );
  const scaling = spec.scaling;
  const actual =
    kind === "gpu_baremetal" && "machineCount" in spec
      ? spec.machineCount
      : kind === "inference" && "replicas" in spec
        ? spec.replicas
        : kind === "vgpu" && "nodePools" in spec
          ? spec.nodePools.reduce((a, p) => a + p.nodeCount, 0)
          : "quantity" in spec
            ? spec.quantity
            : 1;
  const monthlyAt = (n: number) =>
    round(
      lines.reduce(
        (sum, l) => sum + l.hourly * (l.scales ? n / actual : 1),
        0,
      ) * 730,
    );
  return {
    lines,
    hourly,
    monthly: round(hourly * 730),
    floorMonthly: monthlyAt(scaling?.min_size ?? actual),
    peakMonthly: monthlyAt(scaling?.max_size ?? actual),
  };
}
export function costPerHour(resource: Resource, rates: Rate[]) {
  if (
    resource.deletedAt ||
    resource.status === "provisioning" ||
    resource.status === "terminating"
  )
    return 0;
  const e = estimate(resource, rates);
  return round(
    e.lines
      .filter(
        (l) =>
          l.key !== "ip" &&
          (resource.status === "running" || l.key === "storage"),
      )
      .reduce((a, l) => a + l.hourly, 0),
    6,
  );
}
export const deriveTokensPerSecond = (input: {
  mfu: number;
  gpuCount: number;
  peakDenseFlops: number;
  params: number;
  recompute: boolean;
}) =>
  (input.mfu * input.gpuCount * input.peakDenseFlops) /
  ((input.recompute ? 8 : 6) * input.params);
export const decodeUpperBound = (
  bandwidthGbs: number,
  paramsB: number,
  bytesPerParam: number,
  efficiency: number,
) => (bandwidthGbs / (paramsB * bytesPerParam)) * efficiency;
export function modelMemory(
  model: Model,
  quantization: string,
  context: number,
  concurrency = 1,
) {
  const bytes =
    quantization === "bf16"
      ? 2
      : quantization === "fp8"
        ? 1
        : quantization === "awq"
          ? 0.625
          : 0.5625;
  const weights = model.paramsB * bytes;
  const kv =
    (concurrency *
      context *
      2 *
      model.layers *
      model.kvHeads *
      model.headDim *
      2) /
    1e9;
  return {
    weightsGb: weights,
    kvGb: kv,
    requiredGb: weights + kv + Math.max(2, model.paramsB * 0.02) + 2,
    loadS: (weights * 1024) / 1800 + 5,
  };
}
export function allocatedMemoryGb(r: Resource): number {
  if (r.kind === "gpu_vm") return r.spec.memoryGb * r.spec.quantity;
  if (r.kind === "gpu_baremetal") return r.spec.memoryGb * r.spec.machineCount;
  if (r.kind === "vgpu")
    return r.spec.nodePools.reduce(
      (n, p) => n + GPU_SPECS[p.poolCode].memorySystemGb * p.nodeCount,
      0,
    );
  const pool = GPU_SPECS[r.nodePool];
  return Math.round((pool.memorySystemGb / pool.gpusPerNode) * r.spec.gpuCount);
}
export function quotaUse(r: Resource, metric: string): number {
  if (r.deletedAt) return 0;
  if (metric === "storage") return r.spec.storageGb;
  if (
    r.status === "stopped" ||
    r.status === "error" ||
    r.status === "terminating"
  )
    return 0;
  if (metric === "ip") return Number(r.spec.publicIp);
  if (metric === "gpu") return r.spec.gpuCount;
  if (metric === "memory") return allocatedMemoryGb(r);
  if (metric === "vcpu")
    return "vcpu" in r.spec
      ? r.spec.vcpu * r.spec.quantity
      : r.spec.gpuCount * 16;
  return 0;
}

export function meteringLines(estimate: PriceEstimate): PriceLine[] {
  const units = new Map<PriceLine["unit"], PriceLine>();
  for (const line of estimate.lines) {
    const found = units.get(line.unit);
    if (found) {
      found.quantity += line.quantity;
      found.hourly += line.hourly;
      found.unitPrice = found.quantity ? found.hourly / found.quantity : 0;
    } else
      units.set(line.unit, {
        ...line,
        key:
          line.unit === "per_gb_hour"
            ? "storage"
            : line.unit === "per_ip_hour"
              ? "ip"
              : line.unit === "per_cluster_hour"
                ? "control"
                : "compute",
      });
  }
  return [...units.values()];
}
export function provisioningSeconds(
  r: Pick<Resource, "kind" | "spec">,
  models: Model[],
) {
  const spec = r.spec;
  if (r.kind === "gpu_baremetal") return 900;
  if (r.kind === "vgpu") return 300;
  if (r.kind === "inference" && "modelRef" in spec) {
    const model = models.find((m) => m.id === spec.modelRef);
    return model
      ? Math.max(
          60,
          modelMemory(model, spec.quantization, spec.maxModelLen).loadS + 30,
        )
      : 60;
  }
  return 180;
}
