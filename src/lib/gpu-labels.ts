import type { PoolCode } from "../types/domain";

const POOL_LABELS: Record<PoolCode, string> = {
  H100_SXM: "H100 SXM",
  H200_NVL: "H200 SXM",
  B200_NVL72: "B200",
  B300: "B300 SXM",
  GB300_NVL72: "GB300 NVL72",
};

const LEGACY_B200_LABELS = new Set([
  "B200_NVL72",
  "B200 NVL72",
  "B200 NVL72 (GB200)",
  "B200 SXM",
]);

export function poolDisplayName(code: PoolCode | string): string {
  return POOL_LABELS[code as PoolCode] || code.replaceAll("_", " ");
}

export function gpuModelDisplayName(model: string): string {
  return LEGACY_B200_LABELS.has(model) ? "B200" : model;
}
