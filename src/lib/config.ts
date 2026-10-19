import type { Pool, Kind, Resource, ScalingConfig } from "../types/domain";
export const defaultScaling = (kind: Kind): ScalingConfig => ({
  strategy_model: kind === "inference" ? "replica" : "node_pool",
  trigger_metric:
    kind === "inference"
      ? "requests_waiting"
      : kind === "gpu_baremetal"
        ? "gpu_allocation_rate"
        : "queue_depth",
  target_value: kind === "gpu_baremetal" ? 80 : 50,
  min_size: 1,
  max_size: 2,
  scale_to_zero: false,
  drain_timeout_s: 120,
  fallback_enabled: false,
  cooldown_s: kind === "gpu_baremetal" ? 1200 : 300,
  warm_pool: 1,
  weight_cache: "page_cache",
  readiness_gate: true,
  canary_percent: 10,
  maintenance_window: "02:00–04:00",
});
export function defaultSpec(kind: Kind, pool: Pool): Resource["spec"] {
  const common = {
    gpuCount: 1,
    storageGb: 100,
    publicIp: false,
    scaling: null,
    env: {},
    ports: [22, 8888],
  };
  if (kind === "gpu_vm")
    return {
      ...common,
      gpuModel: pool.gpuModel,
      vcpu: 16,
      memoryGb: 128,
      imageRef: "pytorch",
      quantity: 1,
      gpuPerInstance: 1,
      systemDiskGb: 100,
      dataDiskGb: 0,
      systemDiskType: "nvme_ssd",
      dataDiskType: "ssd",
      vpc: "default-vpc",
      subnet: "jp-default",
      securityGroups: ["default"],
      sshPubkey: "",
      bandwidthMbps: 10,
      autoShutdownIdleMin: 60,
      entrypoint: "",
    };
  if (kind === "gpu_baremetal")
    return {
      ...common,
      gpuCount: pool.gpusPerNode,
      machineType: pool.code,
      machineCount: 1,
      gpuModel: pool.gpuModel,
      passthrough: true,
      migPartition: pool.migProfile,
      cpuModel: pool.cpu,
      memoryGb: pool.memorySystemGb,
      localNvmeGb: pool.localNvmeGb,
      raidLevel: "none",
      ibEnabled: true,
      ipmiEnabled: true,
      bmcNetwork: "dedicated",
      imageRef: "ubuntu",
      hostnamePrefix: "runsun",
      sshPubkey: "",
      firmwareBaseline: "recommended",
      vpc: "default-vpc",
      subnet: "jp-default",
    };
  if (kind === "vgpu")
    return {
      ...common,
      gpuCount: pool.gpusPerNode,
      k8sVersion: "1.31",
      controlPlaneTier: "standard",
      nodePools: [
        {
          poolCode: pool.code,
          nodeCount: 1,
          gpuPerNode: pool.gpusPerNode,
          slicingPolicy: "mig",
          migProfile: pool.migProfile,
          timeSliceShare: 2,
        },
      ],
      apiServerPublic: false,
      authorizedCidr: "",
      networkPlugin: "cilium",
      ingressEnabled: false,
      ingressClass: "nginx",
      storageClass: "ssd",
      defaultPvcGb: 100,
      kubeconfigAccess: "download",
      rbacDefaultAdmin: true,
      vpc: "default-vpc",
      subnet: "jp-default",
    };
  return {
    ...common,
    modelRef: "llama8",
    replicas: 1,
    gpuPerReplica: 1,
    quantization: "fp8",
    engine: "vllm",
    port: 8000,
    authEnabled: true,
    maxModelLen: 8192,
    maxBatchSize: 32,
    prefixCaching: true,
    chunkedPrefill: false,
    canaryPercent: 0,
    coldStandby: false,
    warmupPrompt: "",
  };
}

export function normalizeSpec<S extends Resource["spec"]>(spec: S): S {
  const next = { ...spec };
  if ("systemDiskGb" in next) {
    next.storageGb = (next.systemDiskGb + next.dataDiskGb) * next.quantity;
    next.gpuCount = next.gpuDisabled ? 0 : next.gpuPerInstance * next.quantity;
  }
  if ("nodePools" in next) {
    next.gpuCount = next.nodePools.reduce(
      (a, p) => a + p.nodeCount * p.gpuPerNode,
      0,
    );
    next.storageGb = next.defaultPvcGb;
  }
  if ("replicas" in next) next.gpuCount = next.replicas * next.gpuPerReplica;
  return next;
}
