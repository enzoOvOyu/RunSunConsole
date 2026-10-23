import type { BaremetalMachine } from "../../types/baremetal";
import { type Resource } from "../../types/domain";
import type {
  HardwareSnapshot,
  ClusterView,
  ReplicaView,
} from "../../types/monitoring";
import { GPU_SPECS } from "../fixtures/gpu-specs";
import { IMAGES } from "../fixtures/content";
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
  const imageRef = r.kind === "gpu_vm" || r.kind === "gpu_baremetal" ? r.spec.imageRef : undefined;
  const runtimeImageRef = r.kind === "gpu_vm" ? r.spec.runtimeImageRef : undefined;
  const osImage = imageRef ? IMAGES.find((image) => image.id === imageRef) : undefined;
  const runtimeImage = runtimeImageRef ? IMAGES.find((image) => image.id === runtimeImageRef) : undefined;
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
      driver: osImage?.driverVersion || "—",
      cuda: runtimeImage?.cudaVersion || osImage?.cudaVersion || "Not installed",
      compliance: true,
    },
  };
}
export function clusterView(
  r: Extract<Resource, { kind: "vgpu" }>,
  fault = "",
): ClusterView {
  const active = r.status === "running";
  if (r.spec.deploymentMode === "slice") {
    const volume = db.volumes.find((item) => item.resourceUuid === r.resourceUuid && !item.deletedAt && item.role === "pvc");
    const pvc = volume ? [{ namespace: r.spec.slice?.namespace || "default", name: "workspace-pvc", pvName: `${r.displayId}-workspace-pv`, sizeGb: volume.sizeGb, status: "Bound" }] : [];
    const pvs: ClusterView["storage"]["pvs"] = volume ? [{ name: `${r.displayId}-workspace-pv`, source: volume.kind === "file" ? "file" : "block", sizeGb: volume.sizeGb, zone: volume.zone || `${r.region}-a`, nodeUuid: null, status: "Bound", volumeId: volume.id }] : [];
    return {
      summary: { totalNodes: 0, readyNodes: 0, cpuTotal: 0, cpuAllocated: 0, memoryGbTotal: 0, memoryGbAllocated: 0, gpuTotal: 0, gpuAllocated: 0 },
      components: [], nodes: [], workloads: [], scheduling: [],
      network: { cniErrors: 0, serviceP99Ms: null, ingressQps: null, vpcPeering: "unavailable" },
      storage: { bound: pvc.length, pending: 0, pendingReason: "", pvCapacityGb: volume?.sizeGb || 0, provisioned: !!volume, csiErrors: 0, pvs, pvcs: pvc },
      plugins: { gpuOperator: "", gpuOperatorReady: false, devicePluginHealthy: false, nfdVersion: "", nfdReady: false, ingressControllerReady: false, driverReady: 0, driverDesired: 0 },
      poolStatus: active ? "workspace-ready-mock" : "workspace-pending-mock",
    };
  }
  const desired = r.spec.controlPlaneTier === "ha" ? 3 : 1;
  const nodes: ClusterView["nodes"] = r.spec.nodePools.flatMap((pool, poolIndex) => {
    const hardware = GPU_SPECS[pool.poolCode];
    return Array.from({ length: pool.nodeCount }, (_, index) => {
      const nodeUuid = `${r.resourceUuid}-${poolIndex}-${index}`;
      const cordoned = r.labels.includes(`cluster-node:${nodeUuid}:cordoned`);
      return {
        poolIndex, poolCode: pool.poolCode, nodeUuid,
        poolName: pool.name || `gpu-pool-${poolIndex + 1}`,
        name: `${r.displayId}-pool${poolIndex + 1}-node${index + 1}`,
        state: !active ? "initializing" : cordoned ? "unschedulable" : "ready",
        cordoned, gpuCount: hardware.gpusPerNode, allocatedGpu: 0,
        // The existing bare-metal mock assigns 16 vCPU per physical GPU.
        cpuCount: hardware.gpusPerNode * 16, allocatedCpu: 0,
        memoryGb: hardware.memorySystemGb, allocatedMemoryGb: 0,
        gpuModel: hardware.gpuModel,
        privateIp: db.network.interfaces.find((nic) => nic.resourceUuid === r.resourceUuid && !nic.releasedAt && nic.index === desired + r.spec.nodePools.slice(0, poolIndex).reduce((n, item) => n + item.nodeCount, 0) + index)?.privateIp || "—",
        zone: (() => {
          const nic = db.network.interfaces.find((item) => item.resourceUuid === r.resourceUuid && !item.releasedAt && item.index === desired + r.spec.nodePools.slice(0, poolIndex).reduce((n, item) => n + item.nodeCount, 0) + index);
          return db.network.subnets.find((item) => item.id === nic?.subnetId)?.zone || `${r.region}-a`;
        })(),
        allocatedLocalGb: 0,
        os: IMAGES.find((image) => image.id === pool.imageRef)?.name || "Ubuntu 22.04 LTS",
        k8sVersion: r.spec.k8sVersion,
        labels: { ...pool.labels, "runsuncloud.com/node-pool": pool.name || `gpu-pool-${poolIndex + 1}`, "nvidia.com/gpu.product": hardware.gpuModel },
        taints: pool.gpuTaint === false ? [] : ["nvidia.com/gpu=true:NoSchedule"],
        straggler: fault === "straggler" && poolIndex === 0 && index === 0,
        ratio: fault === "straggler" && poolIndex === 0 && index === 0 ? 1.55 : 1.04 + (index % 3) * 0.02,
      };
    });
  });
  const boundVolumes = (r.spec.volumeBindings || []).map((binding) => ({
    binding, volume: db.volumes.find((item) => item.id === binding.volumeId && !item.deletedAt),
  }));
  const generatedBlock = (r.spec.storageMode === "dynamic_block" || r.spec.storageMode === "existing_block") &&
    db.volumes.some((item) => item.resourceUuid === r.resourceUuid && item.id.startsWith(`vol-${r.resourceUuid}-pvc-`) && !item.deletedAt);
  const defaultVolume = r.spec.defaultPvcGb > 0 && !generatedBlock ? db.volumes.find((item) => item.resourceUuid === r.resourceUuid && item.role === "pvc" && item.id === `vol-${r.resourceUuid}-pvc` && !item.deletedAt) : undefined;
  const generatedClaims = generatedBlock ? nodes.map((node) => {
    const index = nodes.filter((candidate) => candidate.poolIndex === node.poolIndex).findIndex((candidate) => candidate.nodeUuid === node.nodeUuid);
    return { node, name: `data-pool${node.poolIndex + 1}-node${index + 1}`,
      volume: db.volumes.find((item) => item.id === `vol-${r.resourceUuid}-pvc-${node.poolIndex}-${index}` && !item.deletedAt) };
  }) : [];
  const localClaims = r.spec.storageMode === "local_nvme" && r.spec.localPvGb ? nodes.map((node) => {
    const index = nodes.filter((candidate) => candidate.poolIndex === node.poolIndex).findIndex((candidate) => candidate.nodeUuid === node.nodeUuid);
    return { node, name: `local-pool${node.poolIndex + 1}-node${index + 1}` };
  }) : [];
  const pvcNodeLocks = new Map<string, string>();
  const workloads: ClusterView["workloads"] = (r.spec.workloads || []).map((workload) => {
    const pods = Array.from({ length: workload.replicas }, (_, index) => {
      const claimKey = `${workload.namespace}/${workload.pvcName || ""}`;
      const claim = workload.namespace === "default" ? generatedClaims.find((item) => item.name === workload.pvcName) : undefined;
      const localClaim = workload.namespace === "default" ? localClaims.find((item) => item.name === workload.pvcName) : undefined;
      const volume = boundVolumes.find(({ binding }) => `${binding.namespace}/${binding.pvcName}` === claimKey)?.volume ||
        (claimKey === "default/default-pvc" ? defaultVolume : claim?.volume);
      const volumeZone = volume?.zone || (volume ? `${r.region}-a` : "");
      const sharedFile = volume?.kind === "file";
      const candidates = nodes.filter((node) =>
        node.state === "ready" &&
        (!workload.pvcName || ((!!volume || !!localClaim) && (localClaim || sharedFile || node.zone === volumeZone) && (!claim || node.nodeUuid === claim.node.nodeUuid) && (!localClaim || node.nodeUuid === localClaim.node.nodeUuid) && (sharedFile || !pvcNodeLocks.has(claimKey) || pvcNodeLocks.get(claimKey) === node.nodeUuid))) &&
        (!workload.nodePoolName || node.poolName === workload.nodePoolName) &&
        (!workload.gpuModel || node.gpuModel === workload.gpuModel) &&
        (!workload.selectorKey || node.labels[workload.selectorKey] === workload.selectorValue) &&
        (workload.tolerateGpuTaint || node.taints.length === 0));
      const node = candidates.find((candidate) =>
        candidate.gpuCount - candidate.allocatedGpu >= workload.gpuPerPod &&
        candidate.cpuCount - candidate.allocatedCpu >= workload.cpuPerPod &&
        candidate.memoryGb - candidate.allocatedMemoryGb >= workload.memoryGbPerPod &&
        (r.spec.localPvGb || 0) - candidate.allocatedLocalGb >= (workload.localStorageGb || 0));
      if (node) {
        node.allocatedGpu += workload.gpuPerPod;
        node.allocatedCpu += workload.cpuPerPod;
        node.allocatedMemoryGb += workload.memoryGbPerPod;
        node.allocatedLocalGb += workload.localStorageGb || 0;
        if (workload.pvcName && !sharedFile) pvcNodeLocks.set(claimKey, node.nodeUuid);
      }
      const waitingReason = !active ? "Cluster is not running" :
        workload.pvcName && !volume && !localClaim ? "PVC is not bound to an available storage volume" :
        !candidates.length ? "No node matches the pool selector, taint tolerance and scheduling state" :
        !node && workload.localStorageGb ? "Insufficient local PV capacity on matching nodes" :
        !node ? "Insufficient GPU, CPU or memory on matching nodes" : "";
      return {
        name: `${workload.name}-${index + 1}`,
        phase: node ? "Running" : "Pending", restarts: 0, oomKilled: 0,
        waitingReason, gpuCount: workload.gpuPerPod,
        cpuCount: workload.cpuPerPod, memoryGb: workload.memoryGbPerPod,
        pvcName: workload.pvcName, localStorageGb: workload.localStorageGb,
        nodeUuid: node?.nodeUuid || null,
      };
    });
    return {
      id: workload.id, kind: workload.kind, namespace: workload.namespace,
      deployment: workload.name, gpuPerPod: workload.gpuPerPod,
      cpuPerPod: workload.cpuPerPod, memoryGbPerPod: workload.memoryGbPerPod,
      nodePoolName: workload.nodePoolName,
      gpuModel: workload.gpuModel,
      selectorKey: workload.selectorKey,
      selectorValue: workload.selectorValue,
      pvcName: workload.pvcName,
      localStorageGb: workload.localStorageGb,
      tolerateGpuTaint: workload.tolerateGpuTaint, pods,
    };
  });
  const summary = {
    totalNodes: nodes.length,
    readyNodes: active ? nodes.length : 0,
    cpuTotal: nodes.reduce((n, node) => n + node.cpuCount, 0),
    cpuAllocated: nodes.reduce((n, node) => n + node.allocatedCpu, 0),
    memoryGbTotal: nodes.reduce((n, node) => n + node.memoryGb, 0),
    memoryGbAllocated: nodes.reduce((n, node) => n + node.allocatedMemoryGb, 0),
    gpuTotal: nodes.reduce((n, node) => n + node.gpuCount, 0),
    gpuAllocated: nodes.reduce((n, node) => n + node.allocatedGpu, 0),
  };
  const pending = workloads.flatMap((workload) => workload.pods)
    .filter((pod) => pod.phase === "Pending");
  const reasons = new Map<string, number>();
  for (const pod of pending) reasons.set(pod.waitingReason, (reasons.get(pod.waitingReason) || 0) + 1);
  const policy = db.policies.find((item) => item.resourceUuid === r.resourceUuid);
  const gpuNodes = nodes.filter((node) => r.spec.nodePools[node.poolIndex].role !== "general");
  const pvs: ClusterView["storage"]["pvs"] = [];
  const pvcs: ClusterView["storage"]["pvcs"] = [];
  if (defaultVolume) {
    pvs.push({ name: `${r.displayId}-pv`, source: defaultVolume.kind === "file" ? "file" : "block", sizeGb: defaultVolume.sizeGb, zone: defaultVolume.kind === "file" ? "—" : defaultVolume.zone || `${r.region}-a`, nodeUuid: null, status: "Bound", volumeId: defaultVolume.id });
    pvcs.push({ namespace: "default", name: "default-pvc", pvName: `${r.displayId}-pv`, sizeGb: defaultVolume.sizeGb, status: "Bound" });
  }
  for (const { node, name, volume } of generatedClaims) {
    const pvName = `${r.displayId}-${name}-pv`;
    pvs.push({ name: pvName, source: "block", sizeGb: volume?.sizeGb || r.spec.defaultPvcGb, zone: node.zone, nodeUuid: node.nodeUuid,
      status: volume ? "Bound" : "Pending", volumeId: volume?.id || null });
    pvcs.push({ namespace: "default", name, pvName: volume ? pvName : null, sizeGb: r.spec.defaultPvcGb, status: volume ? "Bound" : "Pending" });
  }
  if (r.spec.storageMode === "local_nvme" && r.spec.localPvGb) for (const node of nodes) {
    const index = nodes.filter((candidate) => candidate.poolIndex === node.poolIndex).findIndex((candidate) => candidate.nodeUuid === node.nodeUuid);
    const name = `local-pool${node.poolIndex + 1}-node${index + 1}`;
    const pvName = `${r.displayId}-${name}-pv`;
    pvs.push({ name: pvName, source: "local", sizeGb: r.spec.localPvGb, zone: node.zone, nodeUuid: node.nodeUuid, status: "Bound", volumeId: null });
    pvcs.push({ namespace: "default", name, pvName, sizeGb: r.spec.localPvGb, status: "Bound" });
  }
  for (const { binding, volume } of boundVolumes) {
    const ready = !!volume && volume.resourceUuid === r.resourceUuid;
    pvs.push({ name: binding.pvName, source: volume?.kind === "file" ? "file" : "block", sizeGb: volume?.sizeGb || 0, zone: volume?.kind === "file" ? "—" : volume?.zone || `${r.region}-a`, nodeUuid: null, status: ready ? "Bound" : "Pending", volumeId: binding.volumeId });
    pvcs.push({ namespace: binding.namespace, name: binding.pvcName, pvName: ready ? binding.pvName : null, sizeGb: volume?.sizeGb || 0, status: ready ? "Bound" : "Pending" });
  }
  for (const workload of workloads) for (const pod of workload.pods) if (pod.localStorageGb) {
    const pvName = `${pod.name}-local-pv`;
    if (pod.nodeUuid) pvs.push({ name: pvName, source: "local", sizeGb: pod.localStorageGb, zone: nodes.find((node) => node.nodeUuid === pod.nodeUuid)?.zone || `${r.region}-a`, nodeUuid: pod.nodeUuid, status: "Bound", volumeId: null });
    pvcs.push({ namespace: workload.namespace, name: `${pod.name}-local`, pvName: pod.nodeUuid ? pvName : null, sizeGb: pod.localStorageGb, status: pod.nodeUuid ? "Bound" : "Pending" });
  }
  return {
    summary,
    components: ["API Server", "etcd", "Scheduler", "Controller-Manager"].map(
      (name) => ({ name, ready: active ? desired : 0, desired }),
    ),
    nodes, workloads,
    scheduling: [...reasons].map(([reason, count]) => ({ reason, count })),
    network: {
      cniErrors: 0, serviceP99Ms: active && workloads.some((item) => item.pods.some((pod) => pod.phase === "Running")) ? 12.4 : null,
      ingressQps: r.spec.ingressEnabled ? 0 : null,
      vpcPeering: active ? "ready" : "pending",
    },
    storage: {
      bound: pvcs.filter((item) => item.status === "Bound").length,
      pending: pvcs.filter((item) => item.status === "Pending").length,
      pendingReason: pvcs.some((item) => item.status === "Pending") ? "PVC has no matching available PV or node" : "",
      pvCapacityGb: pvs.reduce((total, item) => total + item.sizeGb, 0),
      provisioned: pvcs.length > 0,
      csiErrors: 0, pvs, pvcs,
    },
    plugins: {
      gpuOperator: "24.9.1", gpuOperatorReady: active && gpuNodes.length > 0, devicePluginHealthy: active && gpuNodes.length > 0,
      nfdVersion: "0.16.6", nfdReady: active && gpuNodes.length > 0,
      ingressControllerReady: active && r.spec.ingressEnabled && r.spec.ingressClass === "nginx" && summary.readyNodes > 0,
      driverReady: active ? gpuNodes.length : 0,
      driverDesired: gpuNodes.length,
    },
    poolStatus: !r.spec.scaling ? "idle" : policy?.status === "paused" ? "paused" : "idle",
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
