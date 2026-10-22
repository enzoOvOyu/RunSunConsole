import type {
  Resource,
  ResourceUuid,
  Region,
  Kind,
  PoolCode,
} from "../../types/domain";
import { defaultSpec, normalizeSpec } from "../../lib/config";
import { displayId } from "../../lib/ids";
import { poolsFor } from "./gpu-specs";
import { seededUuid } from "../lib/rng";
export const seedTime = Date.now();
export function seedResources(): Resource[] {
  const baseRows: [Region, Kind, PoolCode, number, number?][] = [
    ["jp", "gpu_vm", "H100_SXM", 8],
    ["jp", "gpu_vm", "H200_NVL", 4],
    ["jp", "gpu_vm", "H100_SXM", 8],
    ["jp", "gpu_baremetal", "H100_SXM", 4],
    ["jp", "vgpu", "H100_SXM", 8],
    ["jp", "inference", "H100_SXM", 4, 2],
    ["jp", "gpu_vm", "H100_SXM", 4],
    ["jp", "gpu_vm", "H100_SXM", 1],
    ["jp", "gpu_baremetal", "H100_SXM", 3],
    ["jp", "vgpu", "H100_SXM", 2],
    ["jp", "inference", "H100_SXM", 1, 1],
    ["sg", "gpu_vm", "H100_SXM", 8],
    ["sg", "gpu_vm", "H200_NVL", 2],
    ["sg", "gpu_baremetal", "H200_NVL", 5],
    ["sg", "vgpu", "B300", 6],
    ["sg", "inference", "H200_NVL", 4, 3],
    ["us", "gpu_vm", "B300", 8],
    ["us", "gpu_vm", "H100_SXM", 4],
    ["us", "gpu_baremetal", "B200_NVL72", 8],
    ["us", "vgpu", "H100_SXM", 16],
    ["us", "inference", "B300", 8, 8],
  ];
  const additionalRows: [Region, Kind, PoolCode, number, number?][] = [
    ["jp", "gpu_vm", "H100_SXM", 2],
    ["jp", "gpu_vm", "B200_NVL72", 2],
    ["jp", "gpu_baremetal", "H200_NVL", 4],
    ["jp", "vgpu", "B200_NVL72", 8],
    ["jp", "inference", "H200_NVL", 2, 2],
    ["jp", "inference", "B200_NVL72", 1, 4],
    ["jp", "gpu_vm", "H100_SXM", 1],
    ["jp", "gpu_baremetal", "H100_SXM", 3],
    ["jp", "vgpu", "H100_SXM", 2],
    ["jp", "inference", "H100_SXM", 1, 1],
    ["sg", "gpu_vm", "H200_NVL", 2],
    ["sg", "gpu_baremetal", "H100_SXM", 5],
    ["sg", "vgpu", "H100_SXM", 6],
    ["sg", "inference", "H200_NVL", 4, 2],
    ["us", "gpu_vm", "B300", 2],
    ["us", "gpu_vm", "H200_NVL", 2],
    ["us", "gpu_baremetal", "H200_NVL", 8],
    ["us", "vgpu", "H100_SXM", 16],
    ["us", "inference", "H200_NVL", 8, 4],
    ["us", "inference", "B300", 4, 4],
  ];
  const rows = [...baseRows, ...additionalRows];
  return rows.map(([region, kind, code, count, replicas], i) => {
    const pool = poolsFor(region).find((p) => p.code === code)!;
    const spec = defaultSpec(kind, pool);
    spec.subnet = `${region}-default`;
    const resourceUuid = seededUuid(i + 1) as ResourceUuid;
    if ("gpuPerInstance" in spec) {
      spec.gpuPerInstance = count;
      spec.gpuCount = count;
      spec.vcpu = count * 16;
      spec.memoryGb = count * 128;
      spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISEED";
      spec.imageRef = ["ubuntu-22.04", "rocky-9", "debian-12", "ubuntu-24.04"][i % 4];
      spec.runtimeImageRef = ["pytorch-cu130", "jupyter-cu130", "vllm-cu130", ""][i % 4];
      spec.dataDiskGb = [0, 200, 500][i % 3];
      spec.bandwidthMbps = [10, 25, 50, 100][i % 4];
      spec.subnet = `${region}-default`;
    }
    if ("machineCount" in spec) {
      spec.machineCount = count;
      spec.gpuCount = count * pool.gpusPerNode;
      spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISEED";
      spec.raidLevel = ["none", "raid0", "raid10"][i % 3];
      spec.imageRef = i % 2 ? "rocky-9" : "ubuntu-24.04";
      spec.subnet = `${region}-default`;
    }
    if ("nodePools" in spec) {
      spec.nodePools[0].nodeCount = count;
      spec.gpuCount = count * pool.gpusPerNode;
      spec.defaultPvcGb = [200, 500, 1000][i % 3];
      spec.storageGb = spec.defaultPvcGb;
      spec.controlPlaneTier = i % 2 ? "ha" : "standard";
      spec.nodePools[0].slicingPolicy = ["mig", "time_slicing", "mps"][i % 3];
      spec.storageClass = ["ssd", "nvme", "shared-fs"][i % 3];
      spec.subnet = `${region}-default`;
      spec.workloads = [{
        id: `seed-workload-${region}-${i}`,
        name: `training-${region}-${i + 1}`,
        namespace: "training", kind: "Deployment",
        replicas: Math.min(count, 4), gpuPerPod: 1,
        cpuPerPod: 4, memoryGbPerPod: 16,
        nodePoolName: spec.nodePools[0].name || "gpu-pool-1",
        tolerateGpuTaint: true,
      }];
    }
    if ("replicas" in spec) {
      spec.gpuPerReplica = count;
      spec.replicas = replicas || 1;
      spec.gpuCount = count * (replicas || 1);
      spec.modelRef =
        count >= 4 ? "llama70" : count === 2 ? "qwen32" : "llama8";
      spec.quantization = count >= 4 && i % 2 ? "bf16" : "fp8";
      spec.engine = ["vllm", "sglang", "trt-llm"][i % 3];
      spec.maxBatchSize = [16, 32, 64][i % 3];
    }
    const status =
      i === 7 || i === 12 ? "stopped" : i === 8 ? "provisioning" : "running";
    const createdAt = new Date(
      status === "provisioning"
        ? seedTime - 60000
        : seedTime -
            (i >= baseRows.length ? 2 + (i % 3) : 10 + (i % 8)) * 86400000,
    ).toISOString();
    return {
      resourceUuid,
      displayId: displayId(kind, resourceUuid),
      kind,
      name: `${kind === "vgpu" ? "训练集群" : kind === "inference" ? "在线服务" : kind === "gpu_baremetal" ? "专属算力" : "开发环境"}-${region}-${i + 1}`,
      region,
      nodePool: code,
      projectId:
        kind === "inference"
          ? "production"
          : kind === "vgpu"
            ? "training"
            : "default",
      status,
      createdAt,
      runningSince: status === "running" ? createdAt : null,
      stoppedAt:
        status === "stopped"
          ? new Date(seedTime - 8 * 3600000).toISOString()
          : null,
      deletedAt: null,
      mode: i % 7 === 0 ? "spot" : "on_demand",
      labels: [region, kind === "inference" ? "production" : "research"],
      orderUuid: seededUuid(500 + i),
      spec: normalizeSpec(spec),
    } as Resource;
  });
}
