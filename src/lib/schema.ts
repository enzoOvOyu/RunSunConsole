import { z } from "zod";
import { REGIONS, POOLS } from "../types/domain";
export const scalingSchema = z
  .object({
    strategy_model: z.enum(["node_pool", "replica"]),
    trigger_metric: z.string().min(1),
    target_value: z.number().positive(),
    min_size: z.number().int().min(0),
    max_size: z.number().int().min(1).max(64),
    scale_to_zero: z.boolean(),
    drain_timeout_s: z.number().min(1).max(3600),
    fallback_enabled: z.boolean(),
    cooldown_s: z.number().min(60).max(3600),
    warm_pool: z.number().int().min(0).max(32),
    weight_cache: z.string(),
    readiness_gate: z.boolean(),
    canary_percent: z.number().min(0).max(99),
    maintenance_window: z.string(),
  })
  .superRefine((s, ctx) => {
    if (
      s.min_size > s.max_size ||
      (s.min_size === 0 && (!s.scale_to_zero || s.strategy_model !== "replica"))
    )
      ctx.addIssue({ code: "custom", message: "INVALID_SCALING" });
  });
const common = {
  gpuCount: z.number().int().positive(),
  storageGb: z.number().min(0),
  publicIp: z.boolean(),
  scaling: scalingSchema.nullable(),
  env: z.record(z.string()).optional(),
  ports: z.array(z.number().int().min(1).max(65535)).optional(),
};
export const serverSchema = z.object({
  ...common,
  gpuCount: z.number().int().min(0),
  gpuDisabled: z.boolean().optional(),
  gpuModel: z.string(),
  vcpu: z.number().int().positive(),
  memoryGb: z.number().positive(),
  imageRef: z.string().min(1),
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
  securityGroups: z.array(z.string()).min(1),
  sshPubkey: z.string().regex(/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/),
  bandwidthMbps: z.number().int().min(1).max(1000),
  autoShutdownIdleMin: z.number(),
  entrypoint: z.string(),
});
export const baremetalSchema = z.object({
  ...common,
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
  hostnamePrefix: z.string().min(1),
  sshPubkey: z.string().regex(/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/),
  firmwareBaseline: z.string(),
  vpc: z.string(),
  subnet: z.string(),
});
export const nodePoolSchema = z.object({
  poolCode: z.enum(POOLS),
  nodeCount: z.number().int().min(1).max(64),
  gpuPerNode: z.number().int().positive(),
  slicingPolicy: z.enum(["none", "mig", "time_slicing", "mps"]),
  migProfile: z.string(),
  timeSliceShare: z.number().int().min(2).max(8),
});
export const vgpuSchema = z.object({
  ...common,
  k8sVersion: z.enum(["1.28", "1.29", "1.30", "1.31"]),
  controlPlaneTier: z.enum(["standard", "ha"]),
  nodePools: z.array(nodePoolSchema).min(1).max(5),
  apiServerPublic: z.boolean(),
  authorizedCidr: z.string(),
  networkPlugin: z.enum(["cilium", "calico"]),
  ingressEnabled: z.boolean(),
  ingressClass: z.string(),
  storageClass: z.enum(["ssd", "nvme", "shared-fs"]),
  defaultPvcGb: z.number().min(0),
  kubeconfigAccess: z.string(),
  rbacDefaultAdmin: z.boolean(),
  vpc: z.string(),
  subnet: z.string(),
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
  canaryPercent: z.number().min(0).max(99),
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
