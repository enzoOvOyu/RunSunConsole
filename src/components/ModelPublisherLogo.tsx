import type { CSSProperties } from "react";

const publisherMeta: Record<string, { name: string; asset: string; file?: string }> = {
  qwen: { name: "Qwen", asset: "qwen" },
  moonshotai: { name: "Moonshot AI", asset: "moonshotai" },
  zaiorg: { name: "Z.ai", asset: "zai-org", file: "zai-org.svg" },
  meta: { name: "Meta", asset: "meta" },
  deepseekai: { name: "DeepSeek", asset: "deepseek-ai" },
  deepseek: { name: "DeepSeek", asset: "deepseek-ai" },
  metamodels: { name: "Meta", asset: "meta" },
  metamod: { name: "Meta", asset: "meta" },
  metam: { name: "Meta", asset: "meta" },
  metalama: { name: "Meta", asset: "meta" },
  metallama: { name: "Meta", asset: "meta" },
  mistralai: { name: "Mistral AI", asset: "mistralai" },
  nvidia: { name: "NVIDIA", asset: "nvidia" },
  lgaiexaone: { name: "LG AI Research", asset: "lgai-exaone" },
  arceeai: { name: "Arcee AI", asset: "arcee-ai" },
  xiaomimimo: { name: "Xiaomi", asset: "xiaomi" },
  minimaxai: { name: "MiniMax", asset: "minimaxai" },
  stepfunai: { name: "StepFun", asset: "stepfun-ai" },
  tencent: { name: "Tencent", asset: "tencent" },
  inclusionai: { name: "inclusionAI", asset: "inclusionai" },
  coherelabs: { name: "Cohere", asset: "coherelabs" },
  nousresearch: { name: "Nous Research", asset: "nousresearch" },
  ai21labs: { name: "AI21 Labs", asset: "ai21labs" },
  baidu: { name: "Baidu", asset: "baidu" },
  openai: { name: "OpenAI", asset: "openai" },
};

function normalizePublisher(publisher: string) {
  return publisher.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function publisherLabel(publisher: string) {
  return publisherMeta[normalizePublisher(publisher)]?.name || publisher;
}

export function ModelPublisherLogo({
  publisher,
  size = 28,
  className,
}: {
  publisher: string;
  size?: number;
  className?: string;
}) {
  const meta = publisherMeta[normalizePublisher(publisher)];
  if (!meta) return null;
  const style: CSSProperties = { width: size, height: size };
  return (
    <img
      className={className}
      src={`/model-providers/${meta.file || `${meta.asset}.png`}`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      style={style}
    />
  );
}
