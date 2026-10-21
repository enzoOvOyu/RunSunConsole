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
    straggler: boolean;
    ratio: number;
  }[];
  workloads: {
    namespace: string;
    deployment: string;
    pods: {
      name: string;
      phase: string;
      restarts: number;
      oomKilled: number;
      waitingReason: string;
      gpuCount: number;
      nodeUuid: string | null;
    }[];
  }[];
  scheduling: { reason: string; count: number }[];
  network: {
    cniErrors: number;
    serviceP99Ms: number;
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
