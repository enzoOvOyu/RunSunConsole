import type { Model, PoolCode } from "../types/domain";

export const BLACKWELL_POOLS: readonly PoolCode[] = [
  "B200_NVL72",
  "B300",
  "GB300_NVL72",
];

export function compatiblePrecisions(
  model: Pick<Model, "quantizations" | "modality">,
  pool: PoolCode,
  engine: string,
): string[] {
  return model.quantizations.filter((precision) => {
    if (precision === "fp4")
      return BLACKWELL_POOLS.includes(pool) && engine !== "sglang";
    if (precision === "awq") return model.modality === "text";
    return precision === "bf16" || precision === "fp8";
  });
}

export function precisionLabel(precision: string): string {
  if (precision === "fp4") return "NVFP4";
  if (precision === "awq") return "INT4 AWQ";
  return precision.toUpperCase();
}
