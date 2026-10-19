import type {
  Resource,
  ResourceUuid,
  Region,
  Kind,
  PoolCode,
} from "../../types/domain";
import { defaultSpec } from "../../lib/config";
import { displayId } from "../../lib/ids";
import { poolsFor } from "./gpu-specs";
import { seededUuid } from "../lib/rng";
export const seedTime = Date.now();
export function seedResources(): Resource[] {
  const rows: [Region, Kind, PoolCode, number, number?][] = [
    ["jp", "gpu_vm", "H100_SXM", 8],
    ["jp", "gpu_vm", "H200_NVL", 8],
    ["jp", "gpu_vm", "H100_SXM", 8],
    ["jp", "gpu_baremetal", "H100_SXM", 8],
    ["jp", "vgpu", "H200_NVL", 16],
    ["jp", "inference", "H100_SXM", 4, 4],
    ["th", "gpu_vm", "H100_SXM", 4],
    ["th", "gpu_vm", "H100_SXM", 2],
    ["th", "gpu_baremetal", "H100_SXM", 6],
    ["th", "vgpu", "H100_SXM", 4],
    ["th", "inference", "H100_SXM", 2, 1],
    ["sg", "gpu_vm", "H100_SXM", 8],
    ["sg", "gpu_vm", "H200_NVL", 4],
    ["sg", "gpu_baremetal", "H200_NVL", 10],
    ["sg", "vgpu", "B300", 12],
    ["sg", "inference", "H200_NVL", 4, 5],
    ["us", "gpu_vm", "B300", 8],
    ["us", "gpu_vm", "H100_SXM", 8],
    ["us", "gpu_baremetal", "B200_NVL72", 16],
    ["us", "vgpu", "H100_SXM", 32],
    ["us", "inference", "B300", 8, 14],
  ];
  return rows.map(([region, kind, code, count, replicas], i) => {
    const pool = poolsFor(region).find((p) => p.code === code)!;
    const spec = defaultSpec(kind, pool);
    const resourceUuid = seededUuid(i + 1) as ResourceUuid;
    if ("gpuPerInstance" in spec) {
      spec.gpuPerInstance = count;
      spec.gpuCount = count;
      spec.vcpu = count * 16;
      spec.memoryGb = count * 128;
      spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISEED";
      spec.subnet = `${region}-default`;
    }
    if ("machineCount" in spec) {
      spec.machineCount = count;
      spec.gpuCount = count * pool.gpusPerNode;
      spec.sshPubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISEED";
      spec.subnet = `${region}-default`;
    }
    if ("nodePools" in spec) {
      spec.nodePools[0].nodeCount = count;
      spec.gpuCount = count * pool.gpusPerNode;
      spec.storageGb = 500;
      spec.subnet = `${region}-default`;
    }
    if ("replicas" in spec) {
      spec.gpuPerReplica = count;
      spec.replicas = replicas || 1;
      spec.gpuCount = count * (replicas || 1);
      spec.modelRef = count >= 4 ? "llama70" : "llama8";
    }
    const status =
      i === 7 || i === 12
        ? "stopped"
        : i === 8
          ? "provisioning"
          : i === 15
            ? "error"
            : "running";
    const createdAt = new Date(
      status === "provisioning"
        ? seedTime - 60000
        : seedTime - (10 + (i % 8)) * 86400000,
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
          : status === "error"
            ? new Date(seedTime - 4 * 3600000).toISOString()
            : null,
      deletedAt: null,
      mode: i % 7 === 0 ? "spot" : "on_demand",
      labels: [region, kind === "inference" ? "production" : "research"],
      orderUuid: seededUuid(500 + i),
      spec,
    } as Resource;
  });
}
