import type { PoolCode, Region, SliceInventoryItem, SliceSku } from "../../types/domain";
import { GPU_SPECS, poolsFor } from "./gpu-specs";

// Profiles and platform baselines:
// https://docs.nvidia.com/datacenter/tesla/mig-user-guide/latest/supported-mig-profiles.html
// https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/25.3/release-notes.html
// https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/26.3/release-notes.html
// One homogeneous, prevalidated 7 x 1g layout per physical GPU model. Stock and
// quotes are demo values, not proof of a production shared pool or tenant isolation.
const definitions: { id: string; poolCode: PoolCode; profile: string; memoryGb: number; hourlyUsd: number; workload: string; k8sVersion: string; gpuOperator: string; driverBranch: string }[] = [
  { id: "mig-h100-1g-10gb", poolCode: "H100_SXM", profile: "1g.10gb", memoryGb: 10, hourlyUsd: 0.75, workload: "GPU development / small inference", k8sVersion: "1.31", gpuOperator: "24.9.1", driverBranch: "R550" },
  { id: "mig-h200-1g-18gb", poolCode: "H200_NVL", profile: "1g.18gb", memoryGb: 18, hourlyUsd: 1.05, workload: "Inference / interactive notebooks", k8sVersion: "1.31", gpuOperator: "24.9.1", driverBranch: "R550" },
  { id: "mig-b200-1g-23gb", poolCode: "B200_NVL72", profile: "1g.23gb", memoryGb: 23, hourlyUsd: 1.65, workload: "Blackwell inference / fine tuning", k8sVersion: "1.32", gpuOperator: "25.3.0", driverBranch: "R570" },
  { id: "mig-b300-1g-34gb", poolCode: "B300", profile: "1g.34gb", memoryGb: 34, hourlyUsd: 1.90, workload: "Large model inference / development", k8sVersion: "1.34", gpuOperator: "26.3.0", driverBranch: "R580" },
  { id: "mig-gb300-1g-35gb", poolCode: "GB300_NVL72", profile: "1g.35gb", memoryGb: 35, hourlyUsd: 2.45, workload: "Grace Blackwell inference / development", k8sVersion: "1.34", gpuOperator: "26.3.0", driverBranch: "R580" },
];
export const SLICE_SKUS: SliceSku[] = definitions.map((item) => ({
  ...item,
  gpuModel: GPU_SPECS[item.poolCode].gpuModel,
  layoutId: `${item.poolCode}-7x-${item.profile}`,
  slicesPerGpu: 7,
  isolation: "MIG hardware partition",
  kubernetesResource: `nvidia.com/mig-${item.profile}`,
  cudaBaseline: "CUDA 12",
}));
export const sliceSku = (id: string) => SLICE_SKUS.find((item) => item.id === id);
export function setSliceSkus(next: SliceSku[]) {
  SLICE_SKUS.splice(0, SLICE_SKUS.length, ...next);
}
export function seedSliceInventory(): SliceInventoryItem[] {
  const gpuCount: Record<Region, Partial<Record<PoolCode, number>>> = {
    jp: { H100_SXM: 2, H200_NVL: 1, B200_NVL72: 1 },
    sg: { H100_SXM: 1, H200_NVL: 1, B300: 1 },
    us: { H100_SXM: 3, H200_NVL: 2, B200_NVL72: 2, B300: 2, GB300_NVL72: 1 },
  };
  return (["jp", "sg", "us"] as Region[]).flatMap((region) =>
    SLICE_SKUS.flatMap((sku) => {
      const count = poolsFor(region).find((pool) => pool.code === sku.poolCode)?.available ? gpuCount[region][sku.poolCode] || 0 : 0;
      return Array.from({ length: count }, (_, gpu) =>
        Array.from({ length: sku.slicesPerGpu }, (_, index): SliceInventoryItem => ({
          id: `${region}-${sku.id}-gpu${gpu + 1}-${index + 1}`,
          region, skuId: sku.id, layoutId: sku.layoutId,
          physicalGpuId: `${region}-${sku.poolCode}-shared-gpu${gpu + 1}`,
          state: gpu === 0 && index === 0 ? "maintenance" : "free",
          resourceUuid: null,
        })),
      ).flat();
    }),
  );
}

// Add newly offered SKUs without resetting allocations from an older saved demo.
export function reconcileSliceInventory(current?: SliceInventoryItem[]): SliceInventoryItem[] {
  const existing = current || [];
  const ids = new Set(existing.map((item) => item.id));
  return [...existing, ...seedSliceInventory().filter((item) => !ids.has(item.id))];
}
