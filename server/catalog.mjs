export const CATALOG_TABLES = {
  rates: "billing_rates",
  pools: "node_pools",
  poolInventory: "node_pool_inventory",
  storageProducts: "storage_products",
  sliceSkus: "slice_skus",
  sliceInventory: "slice_inventory",
};

const REGIONS = ["jp", "sg", "us"];

export function catalogSeed({ rates, pools, supply, storageProducts, sliceSkus, sliceInventory }) {
  return {
    rates: rates.map((rate) => ({
      kind: rate.kind, pool: rate.pool, region: rate.region, unit: rate.unit, unit_price: rate.unitPrice,
    })),
    pools: Object.values(pools).map((pool) => ({
      code: pool.code, display_name: pool.gpuModel, gpu_model: pool.gpuModel,
      gpus_per_node: pool.gpusPerNode, vram_gb: pool.memoryGb, cpu_architecture: pool.cpuArchitecture,
      memory_system_gb: pool.memorySystemGb, local_nvme_gb: pool.localNvmeGb,
      network_technology: pool.networkTechnology, network_ports: pool.networkPorts,
      network_speed_gbps: pool.networkSpeedGbps, bandwidth_gbs: pool.bandwidthGbs,
      bf16_tflops: pool.bf16Tflops, tdp: pool.tdp, cpu: pool.cpu, network: pool.network,
      mig_profile: pool.migProfile,
    })),
    inventory: REGIONS.flatMap((region) =>
      Object.entries(supply[region] || {}).map(([poolCode, availableGpu]) => ({
        region, pool_code: poolCode, available_gpu: availableGpu,
      })),
    ),
    storageProducts: storageProducts.map((product) => ({
      kind: product.kind, tier: product.tier, min_gb: product.minGb, max_gb: product.maxGb,
      step_gb: product.stepGb, usd_gb_month: product.usdGbMonth,
    })),
    sliceSkus: sliceSkus.map((sku) => ({
      id: sku.id, pool_code: sku.poolCode, gpu_model: sku.gpuModel, profile: sku.profile,
      memory_gb: sku.memoryGb, layout_id: sku.layoutId, slices_per_gpu: sku.slicesPerGpu,
      isolation: sku.isolation, kubernetes_resource: sku.kubernetesResource,
      cuda_baseline: sku.cudaBaseline, hourly_usd: sku.hourlyUsd, workload: sku.workload,
      k8s_version: sku.k8sVersion, gpu_operator: sku.gpuOperator, driver_branch: sku.driverBranch,
    })),
    sliceInventory: (sliceInventory || []).map((item) => ({
      id: item.id, region: item.region, sku_id: item.skuId, layout_id: item.layoutId,
      physical_gpu_id: item.physicalGpuId, state: item.state, resource_id: item.resourceUuid,
    })),
  };
}

export async function loadCatalog(client) {
  const rates = await client.query("SELECT kind, pool, region, unit, unit_price FROM billing_rates ORDER BY kind, pool NULLS FIRST, region, unit");
  const pools = await client.query("SELECT code, display_name, gpu_model, gpus_per_node, vram_gb, cpu_architecture, memory_system_gb, local_nvme_gb, network_technology, network_ports, network_speed_gbps, bandwidth_gbs, bf16_tflops, tdp, cpu, network, mig_profile FROM node_pools ORDER BY code");
  const inventory = await client.query("SELECT region, pool_code, available_gpu FROM node_pool_inventory ORDER BY region, pool_code");
  const storageProducts = await client.query("SELECT kind, tier, min_gb, max_gb, step_gb, usd_gb_month FROM storage_products ORDER BY kind, tier");
  const sliceSkus = await client.query("SELECT id, pool_code, gpu_model, profile, memory_gb, layout_id, slices_per_gpu, isolation, kubernetes_resource, cuda_baseline, hourly_usd, workload, k8s_version, gpu_operator, driver_branch FROM slice_skus ORDER BY id");
  const sliceInventory = await client.query("SELECT id, region, sku_id, layout_id, physical_gpu_id, state, resource_id FROM slice_inventory ORDER BY id");
  const supply = {};
  for (const region of REGIONS) supply[region] = {};
  for (const row of inventory.rows) supply[row.region][row.pool_code] = row.available_gpu;
  return {
    rates: rates.rows.map((row) => ({
      kind: row.kind, pool: row.pool, region: row.region, unit: row.unit, unitPrice: Number(row.unit_price),
    })),
    pools: Object.fromEntries(pools.rows.map((row) => [row.code, {
      code: row.code, gpuModel: row.gpu_model, gpusPerNode: row.gpus_per_node, memoryGb: row.vram_gb,
      cpuArchitecture: row.cpu_architecture, memorySystemGb: row.memory_system_gb, localNvmeGb: row.local_nvme_gb,
      networkTechnology: row.network_technology, networkPorts: row.network_ports, networkSpeedGbps: row.network_speed_gbps,
      bandwidthGbs: Number(row.bandwidth_gbs), bf16Tflops: Number(row.bf16_tflops), tdp: row.tdp,
      cpu: row.cpu, network: row.network, migProfile: row.mig_profile,
    }])),
    supply,
    storageProducts: storageProducts.rows.map((row) => ({
      kind: row.kind, tier: row.tier, minGb: row.min_gb, maxGb: row.max_gb, stepGb: row.step_gb, usdGbMonth: Number(row.usd_gb_month),
    })),
    sliceSkus: sliceSkus.rows.map((row) => ({
      id: row.id, poolCode: row.pool_code, gpuModel: row.gpu_model, profile: row.profile, memoryGb: row.memory_gb,
      layoutId: row.layout_id, slicesPerGpu: row.slices_per_gpu, isolation: row.isolation,
      kubernetesResource: row.kubernetes_resource, cudaBaseline: row.cuda_baseline, hourlyUsd: Number(row.hourly_usd),
      workload: row.workload, k8sVersion: row.k8s_version, gpuOperator: row.gpu_operator, driverBranch: row.driver_branch,
    })),
    sliceInventory: sliceInventory.rows.map((row) => ({
      id: row.id, region: row.region, skuId: row.sku_id, layoutId: row.layout_id,
      physicalGpuId: row.physical_gpu_id, state: row.state, resourceUuid: row.resource_id,
    })),
  };
}

export async function seedCatalog(client, catalog) {
  for (const row of catalog.rates)
    await client.query(
      "INSERT INTO billing_rates(kind,pool,region,unit,unit_price) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [row.kind, row.pool, row.region, row.unit, row.unit_price],
    );
  for (const row of catalog.pools)
    await client.query(
      "INSERT INTO node_pools(code,display_name,gpu_model,gpus_per_node,vram_gb,cpu_architecture,memory_system_gb,local_nvme_gb,network_technology,network_ports,network_speed_gbps,bandwidth_gbs,bf16_tflops,tdp,cpu,network,mig_profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING",
      [row.code,row.display_name,row.gpu_model,row.gpus_per_node,row.vram_gb,row.cpu_architecture,row.memory_system_gb,row.local_nvme_gb,row.network_technology,row.network_ports,row.network_speed_gbps,row.bandwidth_gbs,row.bf16_tflops,row.tdp,row.cpu,row.network,row.mig_profile],
    );
  for (const row of catalog.inventory)
    await client.query(
      "INSERT INTO node_pool_inventory(region,pool_code,available_gpu) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [row.region, row.pool_code, row.available_gpu],
    );
  for (const row of catalog.storageProducts)
    await client.query(
      "INSERT INTO storage_products(kind,tier,min_gb,max_gb,step_gb,usd_gb_month) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [row.kind,row.tier,row.min_gb,row.max_gb,row.step_gb,row.usd_gb_month],
    );
  for (const row of catalog.sliceSkus)
    await client.query(
      "INSERT INTO slice_skus(id,pool_code,gpu_model,profile,memory_gb,layout_id,slices_per_gpu,isolation,kubernetes_resource,cuda_baseline,hourly_usd,workload,k8s_version,gpu_operator,driver_branch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING",
      [row.id,row.pool_code,row.gpu_model,row.profile,row.memory_gb,row.layout_id,row.slices_per_gpu,row.isolation,row.kubernetes_resource,row.cuda_baseline,row.hourly_usd,row.workload,row.k8s_version,row.gpu_operator,row.driver_branch],
    );
  for (const row of catalog.sliceInventory)
    await client.query(
      "INSERT INTO slice_inventory(id,region,sku_id,layout_id,physical_gpu_id,state,resource_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [row.id,row.region,row.sku_id,row.layout_id,row.physical_gpu_id,row.state,row.resource_id],
    );
}
