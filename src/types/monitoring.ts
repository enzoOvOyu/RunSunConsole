export interface HardwareSnapshot {
  nodeUid: string;
  available: boolean;
  gpuHealth: {
    ecc_sbe: number;
    ecc_dbe: number;
    row_remap_failed: number;
    retired_pages: number;
    nvlink_crc: number;
    pcie_correctable: number;
    pcie_uncorrectable: number;
  };
  pcie: {
    generation: number;
    width: number;
    acsEnabled: boolean;
    aerErrors: number;
  };
  ibPorts: {
    port: number;
    state: string;
    rateGbps: number;
    txGBps: number;
    rxGBps: number;
    symbolErrors: number;
    linkDownEvents: number;
  }[];
  disks: {
    name: string;
    capacityGb: number;
    mediaErrors: number;
    percentageUsed: number;
    criticalWarning: number;
    temperatureC: number;
    raid: string;
  }[];
  psus: { name: string; status: string; inputPowerW: number }[];
  redundancy: string;
  fans: { name: string; rpm: number; status: string }[] | null;
  inletC: number | null;
  bmc: {
    ip: string;
    firmware: string;
    reachable: boolean;
    selLogCount: number;
    lastSelEntry: string | null;
  };
  firmware: {
    vbios: string;
    driver: string;
    cuda: string;
    compliance: boolean;
  };
}
export interface ClusterView {
  summary: {
    totalNodes: number; readyNodes: number;
    cpuTotal: number; cpuAllocated: number;
    memoryGbTotal: number; memoryGbAllocated: number;
    gpuTotal: number; gpuAllocated: number;
  };
  components: { name: string; ready: number; desired: number }[];
  nodes: {
    poolIndex: number;
    poolCode: string;
    nodeUuid: string;
    name: string;
    state: string;
    cordoned: boolean;
    gpuCount: number;
    allocatedGpu: number;
    cpuCount: number;
    allocatedCpu: number;
    memoryGb: number;
    allocatedMemoryGb: number;
    gpuModel: string;
    poolName: string;
    privateIp: string;
    zone: string;
    allocatedLocalGb: number;
    os: string;
    k8sVersion: string;
    labels: Record<string, string>;
    taints: string[];
    straggler: boolean;
    ratio: number;
  }[];
  workloads: {
    id: string;
    kind: string;
    namespace: string;
    deployment: string;
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
    pods: {
      name: string;
      phase: string;
      restarts: number;
      oomKilled: number;
      waitingReason: string;
      gpuCount: number;
      cpuCount: number;
      memoryGb: number;
      pvcName?: string;
      localStorageGb?: number;
      nodeUuid: string | null;
    }[];
  }[];
  scheduling: { reason: string; count: number }[];
  network: {
    cniErrors: number;
    serviceP99Ms: number | null;
    ingressQps: number | null;
    vpcPeering: string;
  };
  storage: {
    bound: number;
    pending: number;
    pendingReason: string;
    pvCapacityGb: number;
    provisioned: boolean;
    csiErrors: number;
    pvs: { name: string; source: "block" | "file" | "local"; sizeGb: number; zone: string; nodeUuid: string | null; status: string; volumeId: string | null }[];
    pvcs: { namespace: string; name: string; pvName: string | null; sizeGb: number; status: string }[];
  };
  plugins: {
    gpuOperator: string;
    devicePluginHealthy: boolean;
    nfdVersion: string;
    driverReady: number;
    driverDesired: number;
  };
  poolStatus: string;
}
export interface ReplicaView {
  actual: number;
  desired: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  averageGenerationLength: number;
  replicas: {
    name: string;
    phase: string;
    node: string;
    gpuCount: number;
    memoryGb: number;
    rps: number | null;
    requestsRunning: number | null;
    restarts: number;
    uptimeS: number | null;
  }[];
}
