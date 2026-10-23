import type { PoolCode, Region, SliceInventoryItem, SliceSku } from "../../types/domain";
import { GPU_SPECS } from "./gpu-specs";

// H100/H200 profile geometry: https://docs.nvidia.com/datacenter/tesla/mig-user-guide/latest/supported-mig-profiles.html
// GPU Operator 24.9 Kubernetes/driver matrix: https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/24.9/platform-support.html
// Homogeneous, prevalidated 7 x 1g layouts only. These are demo stock and quotes,
// not a claim that a production shared cluster or tenant isolation is deployed.
const definitions: { id: string; poolCode: PoolCode; profile: string; memoryGb: number; hourlyUsd: number; workload: string }[] = [
  { id: "mig-h100-1g-10gb", poolCode: "H100_SXM", profile: "1g.10gb", memoryGb: 10, hourlyUsd: 0.75, workload: "GPU development / small inference" },
  { id: "mig-h200-1g-18gb", poolCode: "H200_NVL", profile: "1g.18gb", memoryGb: 18, hourlyUsd: 1.05, workload: "Inference / interactive notebooks" },
];
export const SLICE_SKUS: SliceSku[] = definitions.map((item) => ({
  ...item,
  gpuModel: GPU_SPECS[item.poolCode].gpuModel,
  layoutId: `${item.poolCode}-7x-${item.profile}`,
  slicesPerGpu: 7,
  isolation: "MIG hardware partition",
  kubernetesResource: `nvidia.com/mig-${item.profile}`,
  k8sVersion: "1.31",
  gpuOperator: "24.9.1",
  driverBranch: "R550",
  cudaBaseline: "CUDA 12",
}));
export const sliceSku = (id: string) => SLICE_SKUS.find((item) => item.id === id);
export function seedSliceInventory(): SliceInventoryItem[] {
  const gpuCount: Record<Region, Record<string, number>> = {
    jp: { "mig-h100-1g-10gb": 2, "mig-h200-1g-18gb": 1 },
    sg: { "mig-h100-1g-10gb": 1, "mig-h200-1g-18gb": 1 },
    us: { "mig-h100-1g-10gb": 3, "mig-h200-1g-18gb": 2 },
  };
  return (["jp", "sg", "us"] as Region[]).flatMap((region) =>
    SLICE_SKUS.flatMap((sku) => Array.from({ length: gpuCount[region][sku.id] }, (_, gpu) =>
      Array.from({ length: sku.slicesPerGpu }, (_, index): SliceInventoryItem => ({
        id: `${region}-${sku.id}-gpu${gpu + 1}-${index + 1}`,
        region, skuId: sku.id, layoutId: sku.layoutId,
        physicalGpuId: `${region}-${sku.poolCode}-shared-gpu${gpu + 1}`,
        state: gpu === 0 && index === 0 ? "maintenance" : "free",
        resourceUuid: null,
      })),
    ).flat()),
  );
}
