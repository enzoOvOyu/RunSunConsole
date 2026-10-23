import {
  KINDS,
  POOLS,
  REGIONS,
  type Rate,
  type PoolCode,
  type Region,
} from "../../types/domain";
import { storageProduct } from "../../lib/storage";
export const BASE_GPU: Record<PoolCode, number> = {
  H100_SXM: 3.49,
  H200_NVL: 4.79,
  B200_NVL72: 7.49,
  B300: 8.49,
  GB300_NVL72: 10.99,
};
export const BASE_MACHINE: Record<PoolCode, number> = {
  H100_SXM: 27.92,
  H200_NVL: 38.32,
  B200_NVL72: 59.92,
  B300: 67.92,
  GB300_NVL72: 791.28,
};
export const MULTIPLIERS: Record<Region, number> = {
  us: 1,
  sg: 1.08,
  jp: 1.12,
};
export const RATES: Rate[] = REGIONS.flatMap((region) => [
  ...KINDS.flatMap((kind) =>
    POOLS.map((pool) => ({
      kind,
      pool,
      region,
      unit:
        kind === "gpu_baremetal"
          ? ("per_machine_hour" as const)
          : ("per_gpu_hour" as const),
      unitPrice:
        (kind === "gpu_baremetal" ? BASE_MACHINE[pool] : BASE_GPU[pool]) *
        MULTIPLIERS[region],
    })),
  ),
  {
    kind: "vgpu" as const,
    pool: null,
    region,
    unit: "per_cluster_hour" as const,
    unitPrice: 0.1,
  },
  {
    kind: "storage" as const,
    pool: null,
    region,
    unit: "per_gb_hour" as const,
    unitPrice: storageProduct("block", "essd_pl0")!.usdGbMonth / 730,
  },
  {
    kind: "public_ip" as const,
    pool: null,
    region,
    unit: "per_ip_hour" as const,
    unitPrice: 0.005,
  },
]);
