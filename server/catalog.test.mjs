import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogSeed, loadCatalog } from "./catalog.mjs";

const sample = {
  rates: [{ kind: "gpu_vm", pool: "H100_SXM", region: "jp", unit: "per_gpu_hour", unitPrice: 3.9 }],
  pools: {
    H100_SXM: {
      code: "H100_SXM", gpuModel: "H100 SXM", gpusPerNode: 8, memoryGb: 80,
      cpuArchitecture: "x86_64", memorySystemGb: 2048, localNvmeGb: 30720,
      networkTechnology: "NDR InfiniBand", networkPorts: 8, networkSpeedGbps: 400,
      bandwidthGbs: 3350, bf16Tflops: 989, tdp: 700, cpu: "x86", network: "IB",
      migProfile: "1g.10gb",
    },
  },
  supply: { jp: { H100_SXM: 16 }, sg: {}, us: {} },
  storageProducts: [{ kind: "block", tier: "essd_pl1", minGb: 40, maxGb: 32760, stepGb: 10, usdGbMonth: 0.14 }],
  sliceSkus: [{
    id: "mig-h100-1g-10gb", poolCode: "H100_SXM", gpuModel: "H100 SXM", profile: "1g.10gb",
    memoryGb: 10, layoutId: "H100_SXM-7x-1g.10gb", slicesPerGpu: 7, isolation: "MIG",
    kubernetesResource: "nvidia.com/mig-1g.10gb", cudaBaseline: "CUDA 12", hourlyUsd: 0.75,
    workload: "dev", k8sVersion: "1.31", gpuOperator: "24.9.1", driverBranch: "R550",
  }],
  sliceInventory: [{ id: "jp-1", region: "jp", skuId: "mig-h100-1g-10gb", layoutId: "H100_SXM-7x-1g.10gb", physicalGpuId: "gpu1", state: "free", resourceUuid: null }],
};

test("catalogSeed maps fixture shapes to SQL columns", () => {
  const seed = catalogSeed(sample);
  assert.equal(seed.rates[0].unit_price, 3.9);
  assert.equal(seed.pools[0].gpus_per_node, 8);
  assert.deepEqual(seed.inventory, [{ region: "jp", pool_code: "H100_SXM", available_gpu: 16 }]);
  assert.equal(seed.storageProducts[0].usd_gb_month, 0.14);
  assert.equal(seed.sliceSkus[0].layout_id, "H100_SXM-7x-1g.10gb");
  assert.equal(seed.sliceInventory[0].resource_id, null);
});

test("loadCatalog restores camelCase fixtures and regional supply", async () => {
  const rows = {
    billing_rates: [{ kind: "gpu_vm", pool: "H100_SXM", region: "jp", unit: "per_gpu_hour", unit_price: "3.9" }],
    node_pools: [{
      code: "H100_SXM", display_name: "H100 SXM", gpu_model: "H100 SXM", gpus_per_node: 8,
      vram_gb: 80, cpu_architecture: "x86_64", memory_system_gb: 2048, local_nvme_gb: 30720,
      network_technology: "IB", network_ports: 8, network_speed_gbps: 400, bandwidth_gbs: "3350",
      bf16_tflops: "989", tdp: 700, cpu: "x86", network: "IB", mig_profile: "1g.10gb",
    }],
    node_pool_inventory: [{ region: "jp", pool_code: "H100_SXM", available_gpu: 16 }],
    storage_products: [{ kind: "block", tier: "essd_pl1", min_gb: 40, max_gb: 32760, step_gb: 10, usd_gb_month: "0.14" }],
    slice_skus: [{
      id: "mig-h100-1g-10gb", pool_code: "H100_SXM", gpu_model: "H100 SXM", profile: "1g.10gb",
      memory_gb: 10, layout_id: "H100_SXM-7x-1g.10gb", slices_per_gpu: 7, isolation: "MIG",
      kubernetes_resource: "nvidia.com/mig-1g.10gb", cuda_baseline: "CUDA 12", hourly_usd: "0.75",
      workload: "dev", k8s_version: "1.31", gpu_operator: "24.9.1", driver_branch: "R550",
    }],
    slice_inventory: [{ id: "jp-1", region: "jp", sku_id: "mig-h100-1g-10gb", layout_id: "H100_SXM-7x-1g.10gb", physical_gpu_id: "gpu1", state: "free", resource_id: null }],
  };
  const client = { query: async (sql) => ({ rows: rows[Object.keys(rows).find((table) => sql.includes(`FROM ${table}`))] || [] }) };
  const catalog = await loadCatalog(client);
  assert.equal(catalog.rates[0].unitPrice, 3.9);
  assert.equal(catalog.pools.H100_SXM.gpusPerNode, 8);
  assert.deepEqual(catalog.supply.jp, { H100_SXM: 16 });
  assert.equal(catalog.storageProducts[0].usdGbMonth, 0.14);
  assert.equal(catalog.sliceSkus[0].poolCode, "H100_SXM");
  assert.equal(catalog.sliceInventory[0].resourceUuid, null);
});
