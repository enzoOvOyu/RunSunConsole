import type { DeploymentNetworkOptions } from "./network";
import type { StorageRequest } from "./storage";
import type { InferenceGatewaySettings } from "./inference";
export const KINDS = ["gpu_vm", "gpu_baremetal", "vgpu", "inference"] as const;
export const REGIONS = ["jp", "sg", "us"] as const;
export const POOLS = [
  "H100_SXM",
  "H200_NVL",
  "B200_NVL72",
  "B300",
  "GB300_NVL72",
] as const;
export const ROLES = ["owner", "admin", "member", "billing", "viewer"] as const;
export type Kind = (typeof KINDS)[number];
export type Region = (typeof REGIONS)[number];
export type PoolCode = (typeof POOLS)[number];
export type Role = (typeof ROLES)[number];
export type ResourceUuid = string & { readonly __brand: "ResourceUuid" };
export type DisplayId = string & { readonly __brand: "DisplayId" };
export type Status =
  "provisioning" | "running" | "stopped" | "error" | "terminating";
export type BillingUnit =
  | "per_gpu_hour"
  | "per_machine_hour"
  | "per_cluster_hour"
  | "per_gb_hour"
  | "per_ip_hour";
export type BillingMode = "on_demand" | "spot" | "reserved";
export interface ScalingConfig {
  strategy_model: "node_pool" | "replica";
  trigger_metric: string;
  target_value: number;
  min_size: number;
  max_size: number;
  scale_to_zero: boolean;
  drain_timeout_s: number;
  fallback_enabled: boolean;
  cooldown_s: number;
  warm_pool: number;
  weight_cache: string;
  readiness_gate: boolean;
  canary_percent: number;
  maintenance_window: string;
}
export interface CommonSpec {
  vpc?: string;
  subnet?: string;
  securityGroups?: string[];
  eipId?: string;
  gpuCount: number;
  storageGb: number;
  baseStorageGb?: number;
  storageSelections?: StorageRequest[];
  publicIp: boolean;
  scaling: ScalingConfig | null;
  env?: Record<string, string>;
  ports?: number[];
}
export interface ServerSpec extends CommonSpec {
  authMethod?: "ssh_key" | "password";
  gpuDisabled?: boolean;
  gpuModel: string;
  vcpu: number;
  memoryGb: number;
  imageRef: string;
  runtimeImageRef?: string;
  quantity: number;
  gpuPerInstance: number;
  systemDiskGb: number;
  dataDiskGb: number;
  systemDiskType: string;
  dataDiskType: string;
  vpc: string;
  subnet: string;
  securityGroups: string[];
  sshPubkey: string;
  bandwidthMbps: number;
  autoShutdownIdleMin: number;
  entrypoint: string;
}
export interface BaremetalSpec extends CommonSpec {
  authMethod?: "ssh_key" | "password";
  machineType: string;
  machineCount: number;
  gpuModel: string;
  passthrough: boolean;
  migPartition: string;
  cpuModel: string;
  memoryGb: number;
  localNvmeGb: number;
  raidLevel: string;
  ibEnabled: boolean;
  ipmiEnabled: boolean;
  bmcNetwork: string;
  imageRef: string;
  hostnamePrefix: string;
  sshPubkey: string;
  firmwareBaseline: string;
  vpc: string;
  subnet: string;
}
export interface ClusterWorkloadSpec {
  id: string;
  name: string;
  namespace: string;
  kind: "Deployment" | "StatefulSet" | "Job";
  replicas: number;
  gpuPerPod: number;
  cpuPerPod: number;
  memoryGbPerPod: number;
  nodePoolName: string;
  gpuModel?: string;
  selectorKey?: string;
  selectorValue?: string;
  pvcName?: string;
  localStorageGb?: number;
  tolerateGpuTaint: boolean;
}
export interface NodePoolSpec {
  name?: string;
  role?: "gpu" | "general";
  minNodes?: number;
  maxNodes?: number;
  diskGb?: number;
  imageRef?: string;
  labels?: Record<string, string>;
  gpuTaint?: boolean;
  poolCode: PoolCode;
  nodeCount: number;
  gpuPerNode: number;
  slicingPolicy: string;
  migProfile: string;
  timeSliceShare: number;
}
export interface ClusterVolumeBinding {
  volumeId: string;
  pvName: string;
  pvcName: string;
  namespace: string;
}
export interface VgpuSpec extends CommonSpec {
  subnets?: string[];
  volumeBindings?: ClusterVolumeBinding[];
  localPvGb?: number;
  storageMode?: "dynamic_block" | "existing_block" | "local_nvme" | "shared_file";
  description?: string;
  podCidr?: string;
  serviceCidr?: string;
  workloads?: ClusterWorkloadSpec[];
  k8sVersion: string;
  controlPlaneTier: "standard" | "ha";
  nodePools: NodePoolSpec[];
  apiServerPublic: boolean;
  authorizedCidr: string;
  networkPlugin: string;
  ingressEnabled: boolean;
  ingressClass: string;
  storageClass: string;
  defaultPvcGb: number;
  kubeconfigAccess: string;
  rbacDefaultAdmin: boolean;
  vpc: string;
  subnet: string;
}
export interface InferenceSpec extends CommonSpec {
  gateway?: InferenceGatewaySettings;
  modelRef: string;
  replicas: number;
  gpuPerReplica: number;
  quantization: string;
  engine: string;
  port: number;
  authEnabled: boolean;
  maxModelLen: number;
  maxBatchSize: number;
  prefixCaching: boolean;
  chunkedPrefill: boolean;
  canaryPercent: number;
  coldStandby: boolean;
  warmupPrompt: string;
}
interface ResourceBase {
  project?: Pick<Project, "id" | "name" | "slug">;
  owner?: { id: string; name: string };
  provisioningSince?: string;
  allocationSource?: "order";
  privateIp?: string;
  placement?: {
    rackId: string;
    switchGroup: string;
    nodes: {
      nodeUuid: string;
      name: string;
      state: string;
      gpuCount: number;
    }[];
  };
  cost?: {
    perHour: number;
    unitPrice: number;
    unit: BillingUnit;
    currency: "USD";
  };
  resourceUuid: ResourceUuid;
  displayId: DisplayId;
  name: string;
  region: Region;
  nodePool: PoolCode;
  projectId: string;
  status: Status;
  createdAt: string;
  runningSince: string | null;
  stoppedAt: string | null;
  deletedAt: string | null;
  mode: BillingMode;
  labels: string[];
  orderUuid: string;
}
export type Resource = ResourceBase &
  (
    | { kind: "gpu_vm"; spec: ServerSpec }
    | { kind: "gpu_baremetal"; spec: BaremetalSpec }
    | { kind: "vgpu"; spec: VgpuSpec }
    | { kind: "inference"; spec: InferenceSpec }
  );
export type ResourceOf<K extends Kind> = Extract<Resource, { kind: K }>;
export interface Project {
  deletedAt?: string | null;
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  defaultRegion: Region;
  labels: string[];
  createdAt: string;
  members: { userId: string; name: string; role: Role }[];
}
export interface Pool {
  code: PoolCode;
  gpuModel: string;
  memoryGb: number;
  bandwidthGbs: number;
  bf16Tflops: number;
  tdp: number;
  gpusPerNode: number;
  cpu: string;
  cpuArchitecture: "x86_64" | "aarch64";
  memorySystemGb: number;
  localNvmeGb: number;
  network: string;
  networkTechnology?: string;
  networkPorts?: number;
  networkSpeedGbps?: number;
  migPreconfigured?: boolean;
  migProfile: string;
  migProfiles?: string[];
  availableGpu: number;
  available: boolean;
  licenseAvailable: number;
}
export interface Rate {
  kind: Kind | "storage" | "public_ip";
  pool: PoolCode | null;
  region: Region;
  unit: BillingUnit;
  unitPrice: number;
}
export interface PriceLine {
  key: string;
  unit: BillingUnit;
  unitPrice: number;
  quantity: number;
  hourly: number;
  scales: boolean;
}
export interface PriceEstimate {
  lines: PriceLine[];
  hourly: number;
  monthly: number;
  floorMonthly: number;
  peakMonthly: number;
}
export interface ResourceEvent {
  id: string;
  resourceUuid: ResourceUuid;
  type: string;
  at: string;
  actor: string;
  component: string;
  reason: string;
  before: string;
  after: string;
  action: string;
  metric: string;
  value: number;
  threshold: number;
}
export interface Usage {
  id: string;
  resourceUuid: ResourceUuid;
  displayId: DisplayId;
  projectId: string;
  region: Region;
  kind: Kind | "eip";
  usageHour: string;
  unit: BillingUnit;
  quantity: number;
  unitPrice: number;
  amount: number;
  status: Status;
}
export interface Invoice {
  id: string;
  period: string;
  issuedAt: string;
  status: "paid";
  grossAmount: number;
  voucherUsed: number;
  amount: number;
}
export interface Transaction {
  id: string;
  resourceUuid: ResourceUuid | null;
  at: string;
  type: "charge" | "refund" | "credit" | "adjustment" | "voucher";
  amount: number;
  balanceAfter: number;
  referenceId: string;
}
export const QUOTA_METRICS = [
  "gpu",
  "vcpu",
  "memory",
  "storage",
  "ip",
] as const;
export interface Quota {
  region: Region;
  metric: (typeof QUOTA_METRICS)[number];
  limitValue: number;
  usedValue: number;
  storageBreakdown?: {
    kind: "block" | "file" | "object";
    usedGb: number;
    limitGb: number;
  }[];
}
export interface ScalingPolicy {
  id: string;
  resourceUuid: ResourceUuid;
  name: string;
  config: ScalingConfig;
  status: "active" | "paused" | "cooldown";
  updatedAt: string;
}
export interface ScalingEvent {
  id: string;
  resourceUuid: ResourceUuid;
  policyId: string;
  direction: "scale_out" | "scale_in";
  from: number;
  to: number;
  metric: string;
  value: number;
  threshold: number;
  durationS: number;
  at: string;
}
export interface Model {
  id: string;
  name: string;
  paramsB: number;
  quantizations: string[];
  license: string;
  modality: string;
  layers: number;
  kvHeads: number;
  headDim: number;
  context: number;
  favorite: boolean;
  modelRef?: string;
  publisher?: string;
  countryCode?: string;
  activeParamsB?: number;
  parameterEstimate?: boolean;
  featuredRank?: number;
  architecture?: string;
  access?: "public" | "terms" | "manual";
  weightFormat?: string;
  sourceUrl?: string;
}
export interface Image {
  id: string;
  name: string;
  framework: string;
  cudaVersion: string;
  driverVersion: string | null;
  sizeGb: number;
  type: "container" | "os";
  source: string;
  osFamily: string;
  osVersion: string;
  architectures: ("x86_64" | "aarch64")[];
  supportedGpuModels: PoolCode[];
  compatibleOsFamilies: string[];
  frameworks: string[];
  description: string;
}
export interface Notebook {
  id: string;
  name: string;
  resourceUuid: ResourceUuid;
  ide: "jupyter" | "vscode";
  imageRef: string;
  storageGb: number;
  autoShutdownIdleMin: number;
  status: string;
  createdAt: string;
  urlPath: string;
}
export interface Dataset {
  id: string;
  name: string;
  latest_version: string;
  size_gb: number;
  format_tag: string;
  createdAt: string;
  updatedAt: string;
  versions: { version: string; size_gb: number; note: string }[];
  preview: Record<string, string | number>[];
  references: { id: string; name: string; href: string }[];
}
export interface StorageObject {
  key: string;
  size: number;
  contentType: string;
  etag: string;
  storageClass: string;
  updatedAt: string;
}
export interface Bucket {
  id: string;
  name: string;
  region: Region;
  projectId?: string;
  storageClass?: "STANDARD" | "IA";
  attachedResourceUuid?: ResourceUuid | null;
  access: "private" | "public_read";
  status: "active";
  quotaGb: number;
  createdAt: string;
  objects: StorageObject[];
  lifecycle: {
    prefix: string;
    action: string;
    after_days: number;
    nextRun: string;
  }[];
  references: { name: string; href: string }[];
}
export interface PipelineNode {
  id: string;
  name: string;
  type: "source" | "process" | "train" | "output";
  inputs: string[];
  parameters: Record<string, string | number>;
}
export interface PipelineRun {
  id: string;
  status: string;
  startedAt: string;
  durationS: number;
  actor: string;
  nodeLogs: { nodeId: string; level: string; at: string; message: string }[];
  artifacts: string[];
}
export interface Pipeline {
  id: string;
  name: string;
  createdAt: string;
  nodes: PipelineNode[];
  runs: PipelineRun[];
}
export type TicketCategory =
  | "gpu_vm"
  | "gpu_baremetal"
  | "kubernetes"
  | "inference"
  | "image_driver"
  | "network_storage"
  | "billing"
  | "quota_access"
  | "technical";
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export interface TicketAttachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  key: string;
  uploadedAt: string;
  uploadedBy: string;
}
export interface TicketMessage {
  actor: string;
  body: string;
  at: string;
  attachments: TicketAttachment[];
}
export interface TicketEvent {
  id: string;
  type: "created" | "reply" | "status_changed";
  actor: string;
  at: string;
  status: TicketStatus;
  summary: string;
}
export interface Ticket {
  id: string;
  caseNumber: string;
  title: string;
  category: TicketCategory;
  resourceUuid: ResourceUuid | null;
  region: Region | null;
  context: Record<string, string>;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolution: string;
  messages: TicketMessage[];
  events: TicketEvent[];
}
export interface Voucher {
  id: string;
  name: string;
  faceValue: number;
  remaining: number;
  expiresAt: string;
  regions: Region[];
  kinds: Kind[];
  redemptions: { at: string; amount: number; referenceId: string }[];
}
export interface Order {
  idempotencyKey?: string;
  orderUuid: string;
  projectId: string;
  resourceUuid: ResourceUuid;
  status: string;
  requested_spec: Resource["spec"];
  price_snapshot: PriceEstimate;
  sourceType: string;
  sourceRefId: string;
  createdAt: string;
}
export interface OperationLog {
  id: string;
  operation: "create" | "delete" | "start" | "stop";
  status: "processing" | "succeeded" | "failed" | "canceled";
  startedAt: string;
  completedAt: string | null;
  elapsedSeconds: number;
  resourceUuid: ResourceUuid;
  displayId: DisplayId;
  resourceName: string;
  projectId: string;
  projectName: string;
  region: Region;
  kind: Kind;
}
export interface MetricPoint {
  at: string;
  value: number | null;
}
export interface MetricSeries {
  capacity?: number;
  comparison?: "above" | "below";
  key: string;
  unit: string;
  threshold: number | null;
  points: MetricPoint[];
}
export interface Account {
  depletedAt?: string | null;
  org: string;
  user: string;
  plan: string;
  creditBalance: number;
  lowBalanceThresholdUsd: number;
  budget: number;
}
export interface DeploymentOptions extends DeploymentNetworkOptions {
  k8sVersions: string[];
}
