import { z } from "zod";
import { REGIONS, POOLS } from "../types/domain";
import { storageProduct } from "./storage";
export const SCALING_METRIC_LIMITS: Record<
  string,
  { min: number; max: number; unit: string }
> = {
  gpu_allocation_rate: { min: 1, max: 100, unit: "%" },
  kv_cache_usage: { min: 1, max: 100, unit: "%" },
  ttft_p99: { min: 1, max: 300000, unit: "ms" },
  qpm: { min: 1, max: 100000, unit: "QPM" },
  queue_depth: { min: 1, max: 100000, unit: "requests" },
  pending_pods: { min: 1, max: 100000, unit: "pods" },
  concurrency: { min: 1, max: 100000, unit: "requests" },
  requests_waiting: { min: 1, max: 100000, unit: "requests" },
};
export const scalingSchema = z
  .object({
    strategy_model: z.enum(["node_pool", "replica"]),
    trigger_metric: z.string().min(1),
    target_value: z.number().int().positive(),
    min_size: z.number().int().min(0),
    max_size: z.number().int().min(1).max(64),
    scale_to_zero: z.boolean(),
    drain_timeout_s: z.number().min(1).max(3600),
    fallback_enabled: z.boolean(),
    cooldown_s: z.number().min(60).max(3600),
    warm_pool: z.number().int().min(0).max(32),
    weight_cache: z.string(),
    canary_percent: z.number().min(0).max(99),
    maintenance_window: z.string(),
  })
  .superRefine((s, ctx) => {
    const targetRange = SCALING_METRIC_LIMITS[s.trigger_metric];
    if (
      !targetRange ||
      s.target_value < targetRange.min ||
      s.target_value > targetRange.max ||
      s.min_size > s.max_size ||
      (s.min_size === 0 && (!s.scale_to_zero || s.strategy_model !== "replica"))
    )
      ctx.addIssue({ code: "custom", message: "INVALID_SCALING" });
  });
export const storageSelectionsSchema = z
  .array(
    z.object({
      key: z.string().min(1),
      kind: z.enum(["block", "file", "object"]),
      tier: z.string().min(1),
      name: z.string().min(3).max(63),
      sizeGb: z.number().int().positive(),
      count: z.number().int().min(1).max(8),
      mountPath: z.string(),
    }),
  )
  .max(8)
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((row) => row.key)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "DUPLICATE_STORAGE" });
    const bucketNames = rows
      .filter((row) => row.kind === "object")
      .map((row) => row.name);
    if (new Set(bucketNames).size !== bucketNames.length)
      ctx.addIssue({ code: "custom", message: "DUPLICATE_BUCKET" });
    for (const [index, row] of rows.entries()) {
      const product = storageProduct(row.kind, row.tier);
      if (
        !product ||
        row.sizeGb < product.minGb ||
        row.sizeGb > product.maxGb ||
        (row.sizeGb - product.minGb) % product.stepGb !== 0 ||
        (row.kind === "object" &&
          (row.count !== 1 ||
            !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(row.name))) ||
        (row.kind === "file" && !/^\/[A-Za-z0-9/._-]+$/.test(row.mountPath))
      )
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "INVALID_STORAGE_SPEC",
        });
    }
  });
const common = {
  vpc: z.string().optional(),
  subnet: z.string().optional(),
  securityGroups: z.array(z.string()).min(1).max(5).optional(),
  eipId: z.string().optional(),
  gpuCount: z.number().int().positive(),
  storageGb: z.number().min(0),
  baseStorageGb: z.number().min(0).optional(),
  storageSelections: storageSelectionsSchema.optional(),
  publicIp: z.boolean(),
  scaling: scalingSchema.nullable(),
  env: z.record(z.string()).optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
};
export const serverSchema = z
  .object({
    authMethod: z.enum(["ssh_key", "password"]).optional(),
    ...common,
    gpuCount: z.number().int().min(0),
    gpuDisabled: z.boolean().optional(),
    gpuModel: z.string(),
    vcpu: z.number().int().positive(),
    memoryGb: z.number().positive(),
    imageRef: z.string().min(1),
    runtimeImageRef: z.string().optional(),
    quantity: z.number().int().min(1).max(50),
    gpuPerInstance: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
    ]),
    systemDiskGb: z.number().min(40).max(2048),
    dataDiskGb: z.number().min(0).max(32768),
    systemDiskType: z.enum(["nvme_ssd", "ssd"]),
    dataDiskType: z.enum(["nvme_ssd", "ssd"]),
    vpc: z.string().min(1),
    subnet: z.string().min(1),
    securityGroups: z.array(z.string()).min(1).max(5),
    sshPubkey: z.string(),
    bandwidthMbps: z.number().int().min(1).max(1000),
    autoShutdownIdleMin: z.number(),
    entrypoint: z.string(),
  })
  .superRefine((value, ctx) => {
    if (
      value.authMethod !== "password" &&
      !/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/.test(value.sshPubkey)
    )
      ctx.addIssue({
        code: "custom",
        path: ["sshPubkey"],
        message: "INVALID_SSH_KEY",
      });
  });
export const baremetalSchema = z
  .object({
    ...common,
    authMethod: z.enum(["ssh_key", "password"]).optional(),
    machineType: z.string(),
    machineCount: z.number().int().min(1).max(32),
    gpuModel: z.string(),
    passthrough: z.boolean(),
    migPartition: z.string(),
    cpuModel: z.string(),
    memoryGb: z.number().positive(),
    localNvmeGb: z.number().positive(),
    raidLevel: z.enum(["none", "raid0", "raid1", "raid10"]),
    ibEnabled: z.boolean(),
    ipmiEnabled: z.boolean(),
    bmcNetwork: z.enum(["shared", "dedicated"]),
    imageRef: z.string().min(1),
    hostnamePrefix: z
      .string()
      .trim()
      .min(1)
      .max(45)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "INVALID_HOSTNAME_PREFIX"),
    sshPubkey: z.string(),
    firmwareBaseline: z.string(),
    vpc: z.string(),
    subnet: z.string(),
  })
  .superRefine((value, ctx) => {
    if (
      value.authMethod !== "password" &&
      !/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/.test(value.sshPubkey)
    )
      ctx.addIssue({
        code: "custom",
        path: ["sshPubkey"],
        message: "INVALID_SSH_KEY",
      });
  });
export const nodePoolSchema = z.object({
  name: z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/).optional(),
  role: z.enum(["gpu", "general"]).optional(),
  minNodes: z.number().int().min(1).max(64).optional(),
  maxNodes: z.number().int().min(1).max(64).optional(),
  diskGb: z.number().int().min(100).max(4096).optional(),
  imageRef: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  gpuTaint: z.boolean().optional(),
  poolCode: z.enum(POOLS),
  nodeCount: z.number().int().min(1).max(64),
  gpuPerNode: z.number().int().positive(),
  slicingPolicy: z.enum(["none", "mig", "time_slicing", "mps"]),
  migProfile: z.string(),
  timeSliceShare: z.number().int().min(2).max(8),
});
export const vgpuSchema = z.object({
  deploymentMode: z.enum(["exclusive", "slice"]).optional(),
  slice: z.object({
    skuId: z.string().min(1),
    count: z.number().int().min(1).max(64),
    profile: z.string().optional(),
    gpuModel: z.string().optional(),
    memoryGb: z.number().optional(),
    layoutId: z.string().optional(),
    kubernetesResource: z.string().optional(),
    unitPriceUsd: z.number().optional(),
    namespace: z.string().optional(),
    workspaceId: z.string().optional(),
    instanceIds: z.array(z.string()).optional(),
  }).optional(),
  description: z.string().trim().max(500).optional(),
  subnets: z.array(z.string()).max(3).optional(),
  volumeBindings: z.array(z.object({
    volumeId: z.string().min(1),
    pvName: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
    pvcName: z.string().regex(/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/),
    namespace: z.string().regex(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/),
  })).max(8).optional(),
  localPvGb: z.number().int().min(0).max(32768).optional(),
  storageMode: z.enum(["dynamic_block", "existing_block", "local_nvme", "shared_file"]).optional(),
  podCidr: z.string().optional(),
  serviceCidr: z.string().optional(),
  workloads: z.array(z.object({
    id: z.string(), name: z.string(), namespace: z.string(),
    kind: z.enum(["Deployment", "StatefulSet", "Job"]),
    replicas: z.number().int().min(1).max(64),
    gpuPerPod: z.number().int().min(0).max(72),
    cpuPerPod: z.number().int().min(1).max(128),
    memoryGbPerPod: z.number().int().min(1).max(1024),
    nodePoolName: z.string(), gpuModel: z.string().optional(),
    selectorKey: z.string().optional(), selectorValue: z.string().optional(),
    pvcName: z.string().optional(), localStorageGb: z.number().int().min(0).max(32768).optional(),
    tolerateGpuTaint: z.boolean(),
  })).optional(),
  ...common,
  securityGroups: z.array(z.string()).max(5).optional(),
  gpuCount: z.number().int().min(0),
  k8sVersion: z.enum(["1.31", "1.32", "1.33", "1.34", "1.35", "1.36", "1.37"]),
  controlPlaneTier: z.enum(["standard", "ha"]),
  nodePools: z.array(nodePoolSchema).max(5).refine(
    (pools) => pools.every((p) => (p.minNodes ?? 1) <= p.nodeCount && p.nodeCount <= (p.maxNodes ?? 64)) &&
      new Set(pools.map((p, i) => p.name || `pool-${i+1}`)).size === pools.length,
    "INVALID_NODE_POOL_RANGE",
  ),
  apiServerPublic: z.boolean(),
  authorizedCidr: z.string(),
  networkPlugin: z.enum(["cilium", "calico"]),
  ingressEnabled: z.boolean(),
  ingressClass: z.string(),
  storageClass: z.enum(["ssd", "nvme", "shared-fs"]),
  defaultPvcGb: z.number().int().min(0).max(32768),
  kubeconfigAccess: z.string(),
  rbacDefaultAdmin: z.boolean(),
  vpc: z.string(),
  subnet: z.string(),
}).superRefine((spec, ctx) => {
  if (spec.deploymentMode === "slice") {
    if (!spec.slice || spec.nodePools.length !== 0 || spec.gpuCount !== 0 || spec.scaling ||
      spec.storageMode === "local_nvme" || spec.apiServerPublic || spec.ingressEnabled)
      ctx.addIssue({ code: "custom", message: "INVALID_SLICE_SPEC" });
  } else if (spec.nodePools.length === 0)
    ctx.addIssue({ code: "custom", message: "INVALID_NODE_POOL_RANGE" });
});
export const inferenceGovernanceSchema = z.object({
  canaryPercent: z.number().int().min(0).max(99),
  qpsLimit: z.number().int().min(1).max(100000),
  timeoutMs: z.number().int().min(1000).max(300000),
});
export const inferenceSchema = z.object({
  ...common,
  modelRef: z.string().min(1),
  replicas: z.number().int().min(1).max(32),
  gpuPerReplica: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(4),
    z.literal(8),
  ]),
  quantization: z.enum(["bf16", "fp8", "fp4", "awq"]),
  engine: z.enum(["vllm", "sglang", "trt-llm"]),
  port: z.number().int().min(1).max(65535),
  authEnabled: z.boolean(),
  maxModelLen: z.number().int().min(4096).max(1048576),
  maxBatchSize: z.number().int().min(1).max(512),
  prefixCaching: z.boolean(),
  chunkedPrefill: z.boolean(),
  canaryPercent: inferenceGovernanceSchema.shape.canaryPercent,
  gateway: inferenceGovernanceSchema
    .pick({ qpsLimit: true, timeoutMs: true })
    .optional(),
  coldStandby: z.boolean(),
  warmupPrompt: z.string(),
});
export const orderSchema = z
  .object({
    projectId: z.string().min(1),
    region: z.enum(REGIONS),
    nodePool: z.enum(POOLS),
    name: z.string().min(3).max(63),
    mode: z.enum(["on_demand", "spot", "reserved"]),
    labels: z.array(z.string()),
  })
  .and(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("gpu_vm"), spec: serverSchema }),
      z.object({ kind: z.literal("gpu_baremetal"), spec: baremetalSchema }),
      z.object({ kind: z.literal("vgpu"), spec: vgpuSchema }),
      z.object({ kind: z.literal("inference"), spec: inferenceSchema }),
    ]),
  );
export function isCidr(value: string) {
  const [address, mask, ...extra] = value.split("/");
  if (
    extra.length ||
    mask === undefined ||
    !/^\d+$/.test(mask) ||
    Number(mask) < 0 ||
    Number(mask) > 32
  )
    return false;
  const octets = address.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (o) => /^\d{1,3}$/.test(o) && Number(o) >= 0 && Number(o) <= 255,
    )
  );
}
