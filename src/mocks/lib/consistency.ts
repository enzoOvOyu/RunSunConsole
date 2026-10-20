import type { Database } from "./database";
import { GPU_SPECS, poolsFor } from "../fixtures/gpu-specs";
import { modelMemory } from "./derive";
import { compatiblePrecisions } from "../../lib/inference-precision";
export function assertConsistency(db: Database, initial = false) {
  const fail = (message: string) => {
    throw new Error(`CONSISTENCY: ${message}`);
  };
  if (initial && db.resources.reduce((n, r) => n + r.spec.gpuCount, 0) !== 1040)
    fail("allocated GPU seed must sum to 1040");
  const ids = new Set<string>();
  for (const r of db.resources) {
    if (ids.has(r.resourceUuid)) fail("duplicate resource UUID");
    ids.add(r.resourceUuid);
    if (!db.projects.some((p) => p.id === r.projectId)) fail("missing project");
    if (!poolsFor(r.region).find((p) => p.code === r.nodePool)?.available)
      fail("pool unavailable in region");
    if (
      r.kind === "gpu_baremetal" &&
      r.spec.gpuCount !==
        r.spec.machineCount * GPU_SPECS[r.nodePool].gpusPerNode
    )
      fail("machine GPU count");
    if (
      r.kind === "gpu_vm" &&
      (r.spec.gpuPerInstance > 8 ||
        r.spec.gpuCount !==
          (r.spec.gpuDisabled ? 0 : r.spec.quantity * r.spec.gpuPerInstance))
    )
      fail("VM GPU count");
    if (r.status === "running" && !r.runningSince) fail("missing runningSince");
    if (r.deletedAt && r.status !== "terminating") fail("deleted lifecycle");
    if (r.kind === "inference") {
      const m = db.models.find((m) => m.id === r.spec.modelRef);
      if (
        m &&
        !compatiblePrecisions(m, r.nodePool, r.spec.engine).includes(
          r.spec.quantization,
        )
      )
        fail("inference precision unsupported");
      if (
        m &&
        modelMemory(m, r.spec.quantization, r.spec.maxModelLen).requiredGb >
          GPU_SPECS[r.nodePool].memoryGb * r.spec.gpuPerReplica
      )
        fail("inference VRAM infeasible");
    }
  }
  for (const u of db.usage) {
    if (Math.abs(u.amount - u.quantity * u.unitPrice) > 0.00011)
      fail("usage amount");
    if (u.kind === "gpu_baremetal" && u.unit === "per_gpu_hour")
      fail("bare metal billing unit");
  }
}
