import type { Resource } from "../../types/domain";
import type { StorageVolume } from "../../types/storage";

export function volumesForResource(resource: Resource): StorageVolume[] {
  const common = {
    projectId: resource.projectId,
    region: resource.region,
    resourceUuid: resource.resourceUuid,
    createdAt: resource.createdAt,
    deletedAt: resource.deletedAt,
  };
  const volumes: StorageVolume[] = [];
  const add = (
    suffix: string,
    name: string,
    kind: StorageVolume["kind"],
    tier: string,
    role: StorageVolume["role"],
    sizeGb: number,
    mountPath: string,
  ) =>
    volumes.push({
      ...common,
      id: `vol-${resource.resourceUuid}-${suffix}`,
      name,
      kind,
      tier,
      role,
      sizeGb,
      mountPath,
    });
  if (resource.kind === "gpu_vm") {
    const spec = resource.spec;
    for (let i = 0; i < spec.quantity; i++) {
      add(
        `system-${i}`,
        `${resource.displayId}-system-${i + 1}`,
        "block",
        spec.systemDiskType === "nvme_ssd" ? "essd_pl1" : "essd_pl0",
        "system",
        spec.systemDiskGb,
        "/",
      );
      if (spec.dataDiskGb > 0)
        add(
          `data-${i}`,
          `${resource.displayId}-data-${i + 1}`,
          "block",
          spec.dataDiskType === "nvme_ssd" ? "essd_pl1" : "essd_pl0",
          "data",
          spec.dataDiskGb,
          "/data",
        );
    }
  } else if (resource.kind === "vgpu") {
    const spec = resource.spec;
    if (spec.defaultPvcGb > 0)
      add(
        "pvc",
        `${resource.displayId}-pvc`,
        spec.storageClass === "shared-fs" ? "file" : "block",
        spec.storageClass === "shared-fs"
          ? "nas_capacity"
          : spec.storageClass === "nvme"
            ? "essd_pl2"
            : "essd_pl0",
        "pvc",
        spec.defaultPvcGb,
        "/mnt/pvc",
      );
  } else {
    const spec = resource.spec;
    const base =
      spec.baseStorageGb ??
      spec.storageGb -
        (spec.storageSelections || [])
          .filter((row) => row.kind !== "object")
          .reduce((sum, row) => sum + row.sizeGb * row.count, 0);
    if (base > 0)
      add(
        "base",
        `${resource.displayId}-base`,
        "block",
        "essd_pl0",
        resource.kind === "inference" ? "cache" : "data",
        base,
        resource.kind === "inference" ? "/models" : "/data",
      );
  }
  for (const row of resource.spec.storageSelections || []) {
    if (row.kind === "object") continue;
    for (let i = 0; i < row.count; i++)
      add(
        `${row.key}-${i}`,
        row.count === 1 ? row.name : `${row.name}-${i + 1}`,
        row.kind,
        row.tier,
        "custom",
        row.sizeGb,
        row.count === 1 ? row.mountPath : `${row.mountPath}-${i + 1}`,
      );
  }
  return volumes;
}

export const seedStorageVolumes = (resources: Resource[]) =>
  resources.flatMap(volumesForResource);
