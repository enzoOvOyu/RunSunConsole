import type {
  Model,
  Image,
  Project,
  Dataset,
  Bucket,
  Pipeline,
  Resource,
  Ticket,
  Voucher,
  Notebook,
} from "../../types/domain";
const iso = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString();
export const MODELS: Model[] = [
  {
    id: "llama8",
    name: "Llama 3.1 8B Instruct",
    paramsB: 8,
    quantizations: ["bf16", "fp8", "awq", "fp4"],
    license: "Llama 3.1",
    modality: "text",
    layers: 32,
    kvHeads: 8,
    headDim: 128,
    context: 131072,
    favorite: true,
  },
  {
    id: "llama70",
    name: "Llama 3.1 70B Instruct",
    paramsB: 70,
    quantizations: ["bf16", "fp8", "awq", "fp4"],
    license: "Llama 3.1",
    modality: "text",
    layers: 80,
    kvHeads: 8,
    headDim: 128,
    context: 131072,
    favorite: false,
  },
  {
    id: "qwen32",
    name: "Qwen 2.5 32B Instruct",
    paramsB: 32,
    quantizations: ["bf16", "fp8", "awq"],
    license: "Apache-2.0",
    modality: "text",
    layers: 64,
    kvHeads: 8,
    headDim: 128,
    context: 131072,
    favorite: true,
  },
  {
    id: "flux",
    name: "FLUX.1 schnell",
    paramsB: 12,
    quantizations: ["bf16", "fp8"],
    license: "Apache-2.0",
    modality: "image",
    layers: 19,
    kvHeads: 8,
    headDim: 128,
    context: 4096,
    favorite: false,
  },
];
export const IMAGES: Image[] = [
  {
    id: "pytorch",
    name: "PyTorch 2.5",
    framework: "PyTorch",
    cudaVersion: "12.4",
    sizeGb: 18,
    type: "container",
    source: "official",
  },
  {
    id: "vllm",
    name: "vLLM 0.7",
    framework: "vLLM",
    cudaVersion: "12.4",
    sizeGb: 14,
    type: "container",
    source: "official",
  },
  {
    id: "jupyter",
    name: "JupyterLab 4",
    framework: "Jupyter",
    cudaVersion: "12.4",
    sizeGb: 12,
    type: "container",
    source: "official",
  },
  {
    id: "vscode",
    name: "VS Code Server",
    framework: "VS Code",
    cudaVersion: "12.4",
    sizeGb: 9,
    type: "container",
    source: "community",
  },
  {
    id: "ubuntu",
    name: "Ubuntu 22.04 LTS",
    framework: "NVIDIA 550",
    cudaVersion: "12.4",
    sizeGb: 8,
    type: "os",
    source: "official",
  },
  {
    id: "rocky",
    name: "Rocky Linux 9",
    framework: "NVIDIA 550",
    cudaVersion: "12.4",
    sizeGb: 6,
    type: "os",
    source: "official",
  },
];
export const PROJECTS: Project[] = ["default", "training", "production"].map(
  (id, i) => ({
    id,
    name: ["默认项目", "模型训练", "生产推理"][i],
    slug: id,
    isDefault: i === 0,
    defaultRegion: i === 2 ? "us" : "jp",
    labels: [id],
    createdAt: iso(25),
    members: [
      { userId: "enzoOvOyu", name: "enzoOvOyu", role: "owner" },
      { userId: "team-ml", name: "ML Team", role: "member" },
    ],
  }),
);
export const DATASETS: Dataset[] = [
  {
    id: "instructions",
    name: "多语种指令集",
    latest_version: "v2.1",
    size_gb: 128.4,
    format_tag: "parquet",
    createdAt: iso(20),
    updatedAt: iso(1),
    versions: [
      {
        version: "v2.1",
        size_gb: 128.4,
        note: "Deduplication + multilingual expansion",
      },
      { version: "v2.0", size_gb: 96.2, note: "Initial training split" },
    ],
    preview: Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      language: ["en", "zh", "th", "ja"][i % 4],
      instruction: `Explain distributed training strategy ${i + 1}`,
      tokens: 64 + i * 17,
    })),
    references: [
      {
        id: "cleaning",
        name: "指令集清洗流水线",
        href: "/data/pipelines?drawer=cleaning",
      },
    ],
  },
  {
    id: "vision",
    name: "视觉评测集",
    latest_version: "v1.0",
    size_gb: 42.8,
    format_tag: "image",
    createdAt: iso(14),
    updatedAt: iso(2),
    versions: [{ version: "v1.0", size_gb: 42.8, note: "Evaluation split" }],
    preview: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      label: ["landscape", "object", "portrait"][i % 3],
      width: 1024,
      height: 1024,
    })),
    references: [],
  },
];
export const BUCKETS: Bucket[] = ["jp", "jp", "sg", "us"].map((region, i) => ({
  id: i === 1 ? "bucket-jp-legacy" : `bucket-${region}`,
  name: i === 1 ? "runsun-jp-legacy-artifacts" : `runsun-${region}-artifacts`,
  region: region as Bucket["region"],
  access: "private",
  quotaGb: 2048,
  createdAt: iso(18 - i),
  objects: [
    {
      key: "models/llama/config.json",
      size: 2048,
      contentType: "application/json",
      etag: `etag-config-${region}`,
      storageClass: "STANDARD",
      updatedAt: iso(1),
    },
    {
      key: "models/llama/model.safetensors",
      size: 8_000_000_000 * (i + 1),
      contentType: "application/octet-stream",
      etag: `etag-model-${region}`,
      storageClass: "STANDARD",
      updatedAt: iso(2),
    },
    {
      key: "datasets/train.parquet",
      size: 24_000_000_000 * (i + 1),
      contentType: "application/octet-stream",
      etag: `etag-data-${region}`,
      storageClass: "STANDARD",
      updatedAt: iso(3),
    },
  ],
  lifecycle: [
    { prefix: "logs/", action: "delete", after_days: 30, nextRun: iso(-1) },
  ],
  references:
    i === 0
      ? [{ name: "指令集清洗流水线", href: "/data/pipelines?drawer=cleaning" }]
      : [],
}));
export const PIPELINES: Pipeline[] = [
  {
    id: "cleaning",
    name: "指令集清洗流水线",
    createdAt: iso(19),
    nodes: [
      {
        id: "source",
        name: "Parquet",
        type: "source",
        inputs: [],
        parameters: { dataset: "instructions", version: "v2.1" },
      },
      {
        id: "dedup",
        name: "MinHash",
        type: "process",
        inputs: ["source"],
        parameters: { threshold: 0.85, workers: 8 },
      },
      {
        id: "train",
        name: "Tokenize",
        type: "train",
        inputs: ["dedup"],
        parameters: { model: "llama8", max_length: 8192 },
      },
      {
        id: "output",
        name: "S3 Parquet",
        type: "output",
        inputs: ["train"],
        parameters: { bucket: "bucket-jp", prefix: "datasets/processed/" },
      },
    ],
    runs: [
      {
        id: "run-001",
        status: "success",
        startedAt: iso(1),
        durationS: 482,
        actor: "enzoOvOyu",
        nodeLogs: [
          {
            nodeId: "dedup",
            level: "info",
            at: iso(1),
            message:
              "input_rows=1500000 output_rows=1284000 duplicate_ratio=0.144",
          },
          {
            nodeId: "train",
            level: "warning",
            at: iso(1),
            message:
              "truncated_rows=128 max_length=8192; inspect long sequences",
          },
        ],
        artifacts: ["datasets/processed/train.parquet"],
      },
    ],
  },
];
export const seedNotebooks = (resources: Resource[]): Notebook[] =>
  resources
    .filter((r) => r.kind === "gpu_vm" && r.status === "running")
    .slice(0, 2)
    .map((r, i) => ({
      id: `nb-${i}`,
      name: `${r.name} Notebook`,
      resourceUuid: r.resourceUuid,
      ide: i ? "vscode" : "jupyter",
      imageRef: i ? "vscode" : "jupyter",
      storageGb: 50,
      autoShutdownIdleMin: 60,
      status: "running",
      createdAt: iso(2),
      urlPath: `/connections/notebook/nb-${i}`,
    }));
export const seedTickets = (resources: Resource[]): Ticket[] => [
  {
    id: "ticket-001",
    title: "申请 GPU 配额提升",
    resourceUuid: resources[0].resourceUuid,
    status: "open",
    priority: "normal",
    createdAt: iso(1),
    messages: [
      { actor: "enzoOvOyu", body: "GPU limit: 400 → 512", at: iso(1) },
    ],
  },
  {
    id: "ticket-002",
    title: "资源异常排查",
    resourceUuid: resources[15].resourceUuid,
    status: "open",
    priority: "high",
    createdAt: iso(0.5),
    messages: [
      {
        actor: "enzoOvOyu",
        body: "MODEL_OOM: inspect KV cache allocation",
        at: iso(0.5),
      },
    ],
  },
];
export const VOUCHERS: Voucher[] = [
  {
    id: "WELCOME-500",
    name: "Welcome Credit",
    faceValue: 500,
    remaining: 350,
    expiresAt: iso(-30),
    regions: ["jp", "sg", "us"],
    kinds: ["gpu_vm", "inference", "vgpu", "gpu_baremetal"],
    redemptions: [
      { at: iso(1), amount: 150, referenceId: `invoice-${iso(1).slice(0, 7)}` },
    ],
  },
  {
    id: "TRAIN-200",
    name: "Training Credit",
    faceValue: 200,
    remaining: 0,
    expiresAt: iso(3),
    regions: ["jp", "us"],
    kinds: ["vgpu", "gpu_baremetal"],
    redemptions: [
      { at: iso(5), amount: 200, referenceId: `invoice-${iso(5).slice(0, 7)}` },
    ],
  },
];
