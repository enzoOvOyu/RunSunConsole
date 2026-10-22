import type { Model } from "../../types/domain";
import { MODEL_RESEARCH } from "./model-research";
import { MODEL_KV_SHAPES } from "./model-runtime";

// IDs and parameter estimates supplied by the project owner; public model metadata is researched separately.
const entries = [
  ["Qwen/Qwen3.8-2.4T-A95B", "2.4T / 95B", "CN"],
  ["moonshotai/Kimi-K3", "2.8T / 104B", "CN"],
  ["zai-org/GLM-5.3", "约 753B", "CN"],
  ["deepseek-ai/DeepSeek-V4-Pro-0813", "约 1.7T", "CN"],
  ["meta-models/Muse-Spark-Open-816B-A42B", "816B / 42B", "US"],
  ["mistralai/Mistral-Large-3-675B-Instruct-2512", "675B", "FR"],
  ["nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16", "550B / 55B", "US"],
  ["LGAI-EXAONE/K-EXAONE-2.0-750B-A37B", "750B / 37B", "KR"],
  ["arcee-ai/Trinity-Large-Thinking", "约 398B", "US"],
  ["deepseek-ai/DeepSeek-V4-Pro", "约 1.6T", "CN"],
  ["moonshotai/Kimi-K2.7-Code", "约 1T", "CN"],
  ["XiaomiMiMo/MiMo-V2.6-Pro-RL", "约 1T", "CN"],
  ["Qwen/Qwen3.5-397B-A17B", "397B / 17B", "CN"],
  ["MiniMaxAI/MiniMax-M3", "约 427B", "CN"],
  ["zai-org/GLM-5.2", "约 753B", "CN"],
  ["stepfun-ai/Step-5-Preview", "约 604B", "CN"],
  ["tencent/Hy4-preview", "约 780B", "CN"],
  ["deepseek-ai/DeepSeek-V4.1-Flash-1017", "约 763B", "CN"],
  ["inclusionAI/Ling-3.1-flash", "约 572B", "CN"],
  ["moonshotai/Kimi-K2.6", "约 1T", "CN"],
  ["Qwen/Qwen3-Coder-480B-A35B-Instruct", "480B / 35B", "CN"],
  ["CohereLabs/command-a-plus-05-2026-bf16", "约 219B", "CA"],
  ["LGAI-EXAONE/K-EXAONE-236B-A23B", "236B / 23B", "KR"],
  ["deepseek-ai/DeepSeek-V3.2", "约 685B", "CN"],
  ["zai-org/GLM-4.7", "约 358B", "CN"],
  ["meta-llama/Llama-4-Maverick-17B-128E-Instruct", "约 402B", "US"],
  ["NousResearch/Hermes-4-405B", "405B", "US"],
  ["meta-llama/Llama-3.1-405B-Instruct", "405B", "US"],
  ["ai21labs/AI21-Jamba-Large-1.7", "约 399B", "IL"],
  ["arcee-ai/Trinity-Large-Preview", "约 398B", "US"],
  ["deepseek-ai/DeepSeek-R1-0528", "671B", "CN"],
  ["deepseek-ai/DeepSeek-R1", "671B", "CN"],
  ["moonshotai/Kimi-K2-Thinking", "约 1T", "CN"],
  ["moonshotai/Kimi-K2.5", "约 1T", "CN"],
  ["XiaomiMiMo/MiMo-V2.5-Pro", "约 1T", "CN"],
  ["Qwen/Qwen3-VL-235B-A22B-Thinking", "235B / 22B", "CN"],
  ["zai-org/GLM-5.3-Flash", "约 321B", "CN"],
  ["Qwen/Qwen3.8-Flash-Next", "约 180B", "CN"],
  ["deepseek-ai/DeepSeek-V4-Flash-0731", "约 304B", "CN"],
  ["MiniMaxAI/MiniMax-M2.7", "约 229B", "CN"],
  ["baidu/ERNIE-4.5-VL-424B-A47B-PT", "424B / 47B", "CN"],
  ["baidu/ERNIE-4.5-300B-A47B-PT", "300B / 47B", "CN"],
  ["nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16", "74B / 9B", "US"],
  ["mistralai/Mistral-Small-4-119B-2603", "119B", "FR"],
  ["mistralai/Leanstral-1.5-119B-A6B", "119B / 6B", "FR"],
  ["mistralai/Devstral-2-123B-Instruct-2512", "123B", "FR"],
  ["nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16", "120B / 12B", "US"],
  ["nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16", "120B / 12B", "US"],
  ["openai/gpt-oss-120b", "约 117B", "US"],
  ["CohereLabs/c4ai-command-a-03-2025", "约 111B", "CA"],
] as const;

const ACTIVE_PARAMS_B: Record<string, number> = {
  "zai-org/GLM-5.3": 40,
  "deepseek-ai/DeepSeek-V4-Pro-0813": 49,
  "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16": 55,
  "LGAI-EXAONE/K-EXAONE-2.0-750B-A37B": 37,
  "XiaomiMiMo/MiMo-V2.6-Pro-RL": 42,
  "zai-org/GLM-5.2": 40,
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": 16,
  "Qwen/Qwen3-Coder-480B-A35B-Instruct": 35,
  "CohereLabs/command-a-plus-05-2026-bf16": 25,
  "LGAI-EXAONE/K-EXAONE-236B-A23B": 23,
  "deepseek-ai/DeepSeek-V3.2": 37,
  "zai-org/GLM-4.7": 32,
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct": 17,
  "deepseek-ai/DeepSeek-R1-0528": 37,
  "Qwen/Qwen3-VL-235B-A22B-Thinking": 22,
  "deepseek-ai/DeepSeek-V4-Flash-0731": 13,
  "MiniMaxAI/MiniMax-M2.7": 10,
  "baidu/ERNIE-4.5-VL-424B-A47B-PT": 47,
  "baidu/ERNIE-4.5-300B-A47B-PT": 47,
  "nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16": 9,
  "mistralai/Devstral-2-123B-Instruct-2512": 123,
  "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16": 12,
  "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16": 12,
  "CohereLabs/c4ai-command-a-03-2025": 111,
};

const DENSE_MODELS = new Set([
  "NousResearch/Hermes-4-405B",
  "meta-llama/Llama-3.1-405B-Instruct",
  "mistralai/Devstral-2-123B-Instruct-2512",
  "CohereLabs/c4ai-command-a-03-2025",
]);

const featured = [
  "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
  "meta-models/Muse-Spark-Open-816B-A42B",
  "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
  "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16",
  "meta-llama/Llama-3.1-405B-Instruct",
  "nvidia/NVIDIA-Nemotron-3.5-Bolt-74B-A9B-BF16",
];

function toBillions(value: string) {
  const match = value.match(/([\d.]+)([BT])/);
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "T" ? 1000 : 1);
}

export const CATALOG_MODELS: Model[] = entries.map(
  ([modelRef, parameters, countryCode], index) => {
    const [total, active] = parameters.split(" / ");
    const publisher = modelRef.split("/")[0];
    const [layers, kvHeads, headDim] = MODEL_KV_SHAPES[modelRef] || [0, 0, 0];
    return {
      id: `catalog-${index + 1}`,
      name: modelRef.split("/")[1].replaceAll("-", " "),
      modelRef,
      publisher,
      countryCode,
      paramsB: toBillions(total),
      parameterEstimate: total.startsWith("约"),
      quantizations: ["bf16", "fp8", "fp4"],
      layers,
      kvHeads,
      headDim,
      ...MODEL_RESEARCH[modelRef],
      activeParamsB:
        MODEL_RESEARCH[modelRef]?.activeParamsB ??
        (active
          ? toBillions(active)
          : ACTIVE_PARAMS_B[modelRef] ??
            (DENSE_MODELS.has(modelRef) ? toBillions(total) : undefined)),
      sourceUrl: `https://huggingface.co/${modelRef}`,
      favorite: false,
      featuredRank:
        featured.indexOf(modelRef) < 0
          ? undefined
          : featured.indexOf(modelRef) + 1,
    };
  },
);
