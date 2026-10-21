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
import { CATALOG_MODELS } from "./model-catalog";
const iso = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString();
export const MODELS: Model[] = [
  {
    id: "llama8",
    publisher: "Meta",
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
    publisher: "Meta",
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
    publisher: "Qwen",
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
    publisher: "Black Forest Labs",
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
  ...CATALOG_MODELS,
];
const x86Pools: Image["supportedGpuModels"] = ["H100_SXM", "H200_NVL", "B200_NVL72", "B300"];
const allPools: Image["supportedGpuModels"] = [...x86Pools, "GB300_NVL72"];
const linuxImage = (id: string, name: string, osFamily: string, osVersion: string, architecture: ("x86_64" | "aarch64")[], pools: Image["supportedGpuModels"], sizeGb: number): Image => ({
  id, name, osFamily, osVersion, architectures: architecture, supportedGpuModels: pools, compatibleOsFamilies: [],
  framework: "Base OS", frameworks: [], cudaVersion: "Not included", driverVersion: "615.71.10",
  sizeGb, type: "os", source: "RunSun verified", description: "Base operating system; AI frameworks and CUDA toolkit are not preinstalled.",
});
export const IMAGES: Image[] = [
  linuxImage("ubuntu-22.04", "Ubuntu 22.04 LTS", "Ubuntu", "22.04 LTS", ["x86_64", "aarch64"], allPools, 8),
  linuxImage("ubuntu-24.04", "Ubuntu 24.04 LTS", "Ubuntu", "24.04 LTS", ["x86_64", "aarch64"], allPools, 9),
  linuxImage("ubuntu-26.04", "Ubuntu 26.04 LTS", "Ubuntu", "26.04 LTS", ["x86_64", "aarch64"], allPools, 10),
  linuxImage("rocky-9", "Rocky Linux 9", "Rocky Linux", "9", ["x86_64"], x86Pools, 7),
  linuxImage("rocky-10", "Rocky Linux 10", "Rocky Linux", "10", ["x86_64"], x86Pools, 7),
  linuxImage("debian-12", "Debian 12", "Debian", "12", ["x86_64", "aarch64"], allPools, 6),
  linuxImage("debian-13", "Debian 13", "Debian", "13", ["x86_64", "aarch64"], allPools, 6),
  { id: "windows-server-2022", name: "Windows Server 2022", osFamily: "Windows Server", osVersion: "2022", architectures: ["x86_64"], supportedGpuModels: x86Pools, compatibleOsFamilies: [], framework: "Base OS", frameworks: [], cudaVersion: "Not included", driverVersion: "616.92", sizeGb: 20, type: "os", source: "RunSun verified", description: "Windows Server base image; CUDA toolkit and AI frameworks are not preinstalled." },
  { id: "windows-server-2025", name: "Windows Server 2025", osFamily: "Windows Server", osVersion: "2025", architectures: ["x86_64"], supportedGpuModels: x86Pools, compatibleOsFamilies: [], framework: "Base OS", frameworks: [], cudaVersion: "Not included", driverVersion: "616.92", sizeGb: 22, type: "os", source: "RunSun verified", description: "Windows Server base image; CUDA toolkit and AI frameworks are not preinstalled." },
  { id: "pytorch-cu130", name: "PyTorch 2.14 · CUDA 13.0", osFamily: "Linux container", osVersion: "CUDA 13.0", architectures: ["x86_64", "aarch64"], supportedGpuModels: allPools, compatibleOsFamilies: ["Ubuntu", "Rocky Linux", "Debian"], framework: "PyTorch 2.14", frameworks: ["PyTorch 2.14"], cudaVersion: "13.0", driverVersion: null, sizeGb: 18, type: "container", source: "PyTorch official", description: "Linux GPU runtime; use with a compatible Linux base OS." },
  { id: "vllm-cu130", name: "vLLM 0.32.0 · CUDA 13.0", osFamily: "Linux container", osVersion: "CUDA 13.0", architectures: ["x86_64", "aarch64"], supportedGpuModels: allPools, compatibleOsFamilies: ["Ubuntu", "Rocky Linux", "Debian"], framework: "vLLM 0.32.0", frameworks: ["vLLM 0.32.0", "PyTorch dependency"], cudaVersion: "13.0", driverVersion: null, sizeGb: 16, type: "container", source: "vLLM official", description: "Linux inference runtime for supported NVIDIA GPUs; requires a Linux host and compatible NVIDIA driver." },
  { id: "vscode-cu130", name: "VS Code Server · CUDA 13.0", osFamily: "Linux container", osVersion: "CUDA 13.0", architectures: ["x86_64", "aarch64"], supportedGpuModels: allPools, compatibleOsFamilies: ["Ubuntu", "Rocky Linux", "Debian"], framework: "VS Code Server", frameworks: ["VS Code Server"], cudaVersion: "13.0", driverVersion: null, sizeGb: 12, type: "container", source: "RunSun verified", description: "Remote development environment; requires a compatible Linux base OS." },
  { id: "jupyter-cu130", name: "JupyterLab 4 · PyTorch 2.14", osFamily: "Linux container", osVersion: "CUDA 13.0", architectures: ["x86_64", "aarch64"], supportedGpuModels: allPools, compatibleOsFamilies: ["Ubuntu", "Rocky Linux", "Debian"], framework: "JupyterLab 4", frameworks: ["JupyterLab 4", "PyTorch 2.14"], cudaVersion: "13.0", driverVersion: null, sizeGb: 20, type: "container", source: "RunSun verified", description: "Notebook runtime with JupyterLab and PyTorch preinstalled; requires a Linux base OS." },
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
  projectId: "default",
  storageClass: "STANDARD",
  attachedResourceUuid: null,
  quotaGb: region === "us" ? 180_000 : 80_000,
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
