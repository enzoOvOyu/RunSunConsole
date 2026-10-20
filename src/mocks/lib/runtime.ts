import type { BaremetalMachine } from "../../types/baremetal";
import { type Resource } from "../../types/domain";
import type {
  HardwareSnapshot,
  ClusterView,
  ReplicaView,
} from "../../types/monitoring";
import { GPU_SPECS } from "../fixtures/gpu-specs";
import { db } from "./database";
import { decodeUpperBound, modelMemory } from "./derive";
export function servingRates(r: Extract<Resource, { kind: "inference" }>) {
  const model = db.models.find((m) => m.id === r.spec.modelRef)!;
  const gpu = GPU_SPECS[r.nodePool];
  const memory = modelMemory(model, r.spec.quantization, 1024);
  const bytes =
    r.spec.quantization === "bf16"
      ? 2
      : r.spec.quantization === "fp8"
        ? 1
        : 0.5;
  const batch = Math.max(
    1,
    Math.min(
      8,
      r.spec.maxBatchSize,
      Math.floor(
        (gpu.memoryGb * r.spec.gpuPerReplica - memory.weightsGb - 4) /
          memory.kvGb,
      ),
    ),
  );
  const tokens =
    decodeUpperBound(
      gpu.bandwidthGbs * r.spec.gpuPerReplica,
      model.paramsB,
      bytes,
      0.67,
    ) *
    batch *
    r.spec.replicas;
  const avgGeneration = 240 + model.paramsB;
  return { tokens, rps: tokens / avgGeneration, avgGeneration, memory };
}
export function baremetalMachines(
  r: Extract<Resource, { kind: "gpu_baremetal" }>,
): BaremetalMachine[] {
  const pool = GPU_SPECS[r.nodePool];
  const segment =
    parseInt(r.resourceUuid.replaceAll("-", "").slice(-4), 16) % 240;
  return Array.from({ length: r.spec.machineCount }, (_, index) => ({
    index,
    nodeUuid: `${r.resourceUuid}-${index + 1}`,
    name: `${r.displayId}-node-${index + 1}`,
    hostname: `${r.spec.hostnamePrefix || r.displayId}-${String(index + 1).padStart(2, "0")}`,
    status: r.status,
    gpuModel: pool.gpuModel,
    gpuCount: pool.gpusPerNode,
    cpuModel: r.spec.cpuModel,
    vcpu: pool.gpusPerNode * 16,
    memoryGb: r.spec.memoryGb,
    localNvmeGb: r.spec.localNvmeGb,
    privateIp:
      db.network.interfaces.find(
        (i) => i.resourceUuid === r.resourceUuid && i.index === index,
      )?.privateIp || "—",
    bmcIp: `10.255.${segment}.${index + 10}`,
    rack: `${r.region.toUpperCase()}-R${Math.floor(index / 8) + 1}`,
    network: pool.network,
  }));
}
export function hardwareSnapshot(
  r: Resource,
  nodeIndex = 0,
  fault = "",
): HardwareSnapshot {
  const gpu = GPU_SPECS[r.nodePool];
  const liquid = ["B200_NVL72", "B300", "GB300_NVL72"].includes(r.nodePool);
  const available = r.status === "running" || r.status === "error";
  const damaged = fault === "xid48";
  const machine =
    r.kind === "gpu_baremetal" ? baremetalMachines(r)[nodeIndex] : undefined;
  const power =
    gpu.gpusPerNode * gpu.tdp * 0.74 + (gpu.gpusPerNode === 72 ? 9000 : 500);
  return {
    nodeUid: machine?.name ?? `${r.displayId}-node-${nodeIndex + 1}`,
    available,
    gpuHealth: {
      ecc_sbe: 0,
      ecc_dbe: damaged ? 2 : 0,
      row_remap_failed: 0,
      retired_pages: 0,
      nvlink_crc: 0,
      pcie_correctable: 0,
      pcie_uncorrectable: 0,
    },
    pcie: { generation: 5, width: 16, acsEnabled: false, aerErrors: 0 },
    ibPorts: Array.from({ length: 8 }, (_, i) => ({
      port: i + 1,
      state: available ? "ready" : "pending",
      rateGbps: r.nodePool === "B300" ? 800 : 400,
      txGBps: available ? 18.4 + i * 0.4 : 0,
      rxGBps: available ? 16.7 + i * 0.3 : 0,
      symbolErrors: 0,
      linkDownEvents: 0,
    })),
    disks: Array.from({ length: 8 }, (_, i) => ({
      name: `nvme${i}n1`,
      capacityGb: gpu.localNvmeGb / 8,
      mediaErrors: 0,
      percentageUsed: 11 + i * 2 + (nodeIndex % 4),
      criticalWarning: 0,
      temperatureC: 42 + ((i + nodeIndex) % 4),
      raid: r.kind === "gpu_baremetal" ? r.spec.raidLevel : "none",
    })),
    psus: Array.from({ length: 4 }, (_, i) => ({
      name: `PSU ${i + 1}`,
      status: available ? "ready" : "pending",
      inputPowerW: available ? Math.round(power / 4) : 0,
    })),
    redundancy: "2N",
    fans: liquid
      ? null
      : Array.from({ length: 6 }, (_, i) => ({
          name: `FAN ${i + 1}`,
          rpm: 6800 + i * 120 + nodeIndex * 10,
          status: "ready",
        })),
    inletC: liquid ? null : 24,
    bmc: {
      ip: machine?.bmcIp ?? `10.255.${nodeIndex}.10`,
      firmware: "2.14.0",
      reachable:
        !r.deletedAt && (r.kind !== "gpu_baremetal" || r.spec.ipmiEnabled),
      selLogCount: damaged ? 1 : 0,
      lastSelEntry: damaged
        ? "Xid 48: uncorrectable double-bit ECC error; isolate GPU"
        : null,
    },
    firmware: {
      vbios: liquid ? "97.00.68.00.01" : "96.00.68.00.01",
      driver: liquid ? "570.124.06" : "550.127.05",
      cuda: liquid ? "12.8" : "12.4",
      compliance: true,
    },
  };
}
export function clusterView(
  r: Extract<Resource, { kind: "vgpu" }>,
  fault = "",
): ClusterView {
  const active = r.status === "running";
  const count = r.spec.nodePools.reduce((n, p) => n + p.nodeCount, 0);
  const desired = r.spec.controlPlaneTier === "ha" ? 3 : 1;
  const nodes = r.spec.nodePools.flatMap((pool, poolIndex) =>
    Array.from({ length: pool.nodeCount }, (_, i) => ({
      poolIndex,
      poolCode: pool.poolCode,
      nodeUuid: `${r.resourceUuid}-${poolIndex}-${i}`,
      name: `${r.displayId}-pool${poolIndex + 1}-node${i + 1}`,
      state: active ? "ready" : "initializing",
      gpuCount: GPU_SPECS[pool.poolCode].gpusPerNode,
      allocatedGpu: active
        ? Math.floor(GPU_SPECS[pool.poolCode].gpusPerNode * 0.75)
        : 0,
      straggler: fault === "straggler" && poolIndex === 0 && i === 0,
      ratio:
        fault === "straggler" && poolIndex === 0 && i === 0
          ? 1.55
          : 1.04 + (i % 3) * 0.02,
    })),
  );
  const workloads = [
    {
      namespace: "training",
      deployment: `${r.displayId}-trainer`,
      pods: Array.from({ length: Math.min(count * 2, 32) }, (_, i) => ({
        name: `trainer-${i + 1}`,
        phase: active
          ? i === count * 2 - 1 || i === 31
            ? "Pending"
            : "Running"
          : "Pending",
        restarts: i === 1 ? 1 : 0,
        oomKilled: 0,
        waitingReason:
          active && i < count * 2 - 1 && i !== 31
            ? ""
            : "Insufficient nvidia.com/gpu",
        gpuCount: 1,
      })),
    },
    {
      namespace: "inference",
      deployment: `${r.displayId}-gateway`,
      pods: [
        {
          name: "gateway-1",
          phase: active ? "Running" : "Pending",
          restarts: 0,
          oomKilled: 0,
          waitingReason: active ? "" : "ContainerCreating",
          gpuCount: 0,
        },
      ],
    },
  ];
  return {
    components: ["API Server", "etcd", "Scheduler", "Controller-Manager"].map(
      (name) => ({ name, ready: active ? desired : 0, desired }),
    ),
    nodes,
    workloads,
    scheduling: [
      { reason: "Insufficient nvidia.com/gpu", count: 2 },
      { reason: "node(s) had taint", count: 1 },
    ],
    network: {
      cniErrors: 0,
      serviceP99Ms: 12.4,
      ingressQps: active ? 180 : 0,
      vpcPeering: active ? "ready" : "pending",
    },
    storage: {
      bound: active ? 4 : 0,
      pending: 1,
      pendingReason: "WaitForFirstConsumer: volume awaits scheduled pod",
      pvCapacityGb: r.spec.defaultPvcGb,
      csiErrors: 0,
    },
    plugins: {
      gpuOperator: "24.9.1",
      devicePluginHealthy: active,
      nfdVersion: "0.16.6",
      driverReady: active ? count : 0,
      driverDesired: count,
    },
    poolStatus: "scaling_up",
  };
}
export function replicaView(
  r: Extract<Resource, { kind: "inference" }>,
  fault = "",
): ReplicaView {
  const active = r.status === "running";
  const rates = servingRates(r);
  const boundary =
    r.status === "running"
      ? Date.now()
      : r.stoppedAt
        ? new Date(r.stoppedAt).getTime()
        : new Date(r.createdAt).getTime();
  const elapsed = Math.max(
    0,
    (boundary - new Date(r.runningSince || r.createdAt).getTime()) / 1000,
  );
  const measurable = active || r.status === "error";
  const requests = Math.floor(rates.rps * elapsed);
  const failed = Math.floor(requests * 0.0008);
  const gpu = GPU_SPECS[r.nodePool];
  return {
    actual: active ? r.spec.replicas : 0,
    desired:
      r.status === "stopped"
        ? 0
        : r.spec.replicas + (fault === "insufficient" ? 1 : 0),
    requestCount: requests,
    successCount: requests - failed,
    failedCount: failed,
    averageGenerationLength: rates.avgGeneration,
    replicas: Array.from({ length: r.spec.replicas }, (_, i) => ({
      name: `${r.displayId}-${i + 1}`,
      phase: r.status === "error" ? "error" : active ? "running" : "pending",
      node: `${r.displayId}-node-${Math.floor((i * r.spec.gpuPerReplica) / gpu.gpusPerNode) + 1}`,
      gpuCount: r.spec.gpuPerReplica,
      memoryGb: gpu.memoryGb * r.spec.gpuPerReplica,
      rps: measurable
        ? Math.round((rates.rps / r.spec.replicas) * 100) / 100
        : null,
      requestsRunning: measurable
        ? Math.min(r.spec.maxBatchSize, 8 + (i % 4))
        : null,
      restarts: db.replicaRestarts?.[r.resourceUuid]?.[String(i)] || 0,
      uptimeS: measurable ? elapsed : null,
    })),
  };
}
