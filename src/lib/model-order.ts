import type { Model } from "../types/domain";

// The default catalog spotlight is independent of ranks in saved Mock data.
export const FEATURED_MODEL_REFS = [
  "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
  "meta-models/Muse-Spark-Open-816B-A42B",
  "mistralai/Mistral-Large-3-675B-Instruct-2512",
  "moonshotai/Kimi-K3",
  "deepseek-ai/DeepSeek-V4-Pro-0813",
  "Qwen/Qwen3.8-2.4T-A95B",
] as const;

const featuredOrder = new Map<string, number>(
  FEATURED_MODEL_REFS.map((ref, index) => [ref, index]),
);

export function compareFeaturedModels(left: Model, right: Model) {
  const leftOrder = featuredOrder.get(left.modelRef || "");
  const rightOrder = featuredOrder.get(right.modelRef || "");
  if (leftOrder !== undefined || rightOrder !== undefined)
    return (leftOrder ?? 999) - (rightOrder ?? 999);
  return (left.featuredRank ?? 999) - (right.featuredRank ?? 999);
}
