import type { Resource } from "../../types/domain";
import type { StorageVolume } from "../../types/storage";

export function volumesForResource(resource: Resource): StorageVolume[] {
  const common = {
    projectId: resource.projectId,
    region: resource.region,
    zone: `${resource.region}-a`,
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
    if (spec.defaultPvcGb > 0) {
      if (spec.deploymentMode !== "slice" && (spec.storageMode === "dynamic_block" || spec.storageMode === "existing_block")) {
        spec.nodePools.forEach((pool, poolIndex) => {
          for (let index = 0; index < pool.nodeCount; index++)
            add(`pvc-${poolIndex}-${index}`, `${resource.displayId}-pool${poolIndex + 1}-node${index + 1}-data`, "block",
              spec.storageClass === "nvme" ? "essd_pl2" : "essd_pl0", "pvc", spec.defaultPvcGb, `/pvc/data-pool${poolIndex + 1}-node${index + 1}`);
        });
      } else add("pvc", `${resource.displayId}-pvc`, spec.storageMode === "shared_file" || spec.storageClass === "shared-fs" ? "file" : "block",
        spec.storageMode === "shared_file" || spec.storageClass === "shared-fs" ? "nas_capacity" : spec.storageClass === "nvme" ? "essd_pl2" : "essd_pl0",
        "pvc", spec.defaultPvcGb, "/mnt/pvc");
    }
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
        row.kind === "block" && !row.key.startsWith("attached_") ? "" : row.count === 1 ? row.mountPath : `${row.mountPath}-${i + 1}`,
      );
  }
  return volumes;
}

// Regional quota reservations are not tenant-owned volumes.
const allocatedStorageGb = {
  jp: { block: 360_000, file: 280_000 },
  sg: { block: 180_000, file: 140_000 },
  us: { block: 360_000, file: 260_000 },
} as const;

export function seedStandaloneVolumes(resources: Resource[]): StorageVolume[] {
  const attached = resources.flatMap(volumesForResource);
  const volumes: StorageVolume[] = [];
  for (const region of ["jp", "sg", "us"] as const) {
    for (const kind of ["block", "file"] as const) {
      const attachedGb = attached
        .filter(
          (volume) =>
            volume.region === region &&
            volume.kind === kind &&
            !volume.deletedAt,
        )
        .reduce((total, volume) => total + volume.sizeGb, 0);
      let remaining = allocatedStorageGb[region][kind] - attachedGb;
      if (remaining < 0)
        throw new Error(`Seed ${region} ${kind} exceeds allocation`);
      let index = 0;
      while (remaining > 0) {
        const sizeGb = Math.min(
          remaining,
          kind === "block" ? 32_760 : 1_048_500,
        );
        index++;
        volumes.push({
          id: `vol-${region}-${kind}-allocated-${index}`,
          name: `${region.toUpperCase()}-${kind}-allocated-${index}`,
          kind,
          tier: kind === "block" ? "essd_pl1" : "nas_capacity",
          role: "custom",
          sizeGb,
          projectId: "default",
          region,
          zone: `${region}-a`,
          resourceUuid: null,
          mountPath: "",
          createdAt: resources[0].createdAt,
          deletedAt: null,
          inventoryScope: "regional_pool",
        });
        remaining -= sizeGb;
      }
    }
  }
  return volumes;
}

export const seedStorageVolumes = (resources: Resource[]) => [
  ...resources.flatMap(volumesForResource),
  ...seedStandaloneVolumes(resources),
];
