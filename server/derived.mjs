const number = (value) => Number(value || 0);
const money = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;

async function allocations(client) {
  const gpu = await client.query(
    "SELECT region, project_id, kind, gpu_count, vcpu_count, memory_gb FROM current_compute_usage",
  );
  const storage = await client.query(
    "SELECT region, kind, used_gb FROM current_storage_usage",
  );
  const network = await client.query(
    "SELECT region, metric, used_value FROM current_network_usage",
  );
  return { gpu: gpu.rows, storage: storage.rows, network: network.rows };
}

function applyQuotas(quotas, allocation) {
  for (const quota of quotas) {
    if (["gpu", "vcpu", "memory"].includes(quota.metric)) {
      const column =
        quota.metric === "gpu"
          ? "gpu_count"
          : quota.metric === "vcpu"
            ? "vcpu_count"
            : "memory_gb";
      quota.usedValue = allocation.gpu
        .filter((row) => row.region === quota.region)
        .reduce((sum, row) => sum + number(row[column]), 0);
    }
    if (quota.metric === "ip") {
      quota.usedValue = allocation.network
        .filter((row) => row.region === quota.region && row.metric === "ip")
        .reduce((sum, row) => sum + number(row.used_value), 0);
    }
    if (quota.metric === "storage") {
      for (const part of quota.storageBreakdown || []) {
        part.usedGb = allocation.storage
          .filter(
            (row) => row.region === quota.region && row.kind === part.kind,
          )
          .reduce((sum, row) => sum + number(row.used_gb), 0);
      }
      quota.usedValue = (quota.storageBreakdown || []).reduce(
        (sum, part) => sum + part.usedGb,
        0,
      );
    }
  }
}

async function applyBilling(client, data, url) {
  const period =
    url.searchParams.get("billing_period") ||
    new Date().toISOString().slice(0, 7);
  const region = url.searchParams.get("region");
  const resource = url.searchParams.get("resource_id");
  const result = await client.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE to_char(usage_hour AT TIME ZONE 'UTC', 'YYYY-MM') = $1), 0) AS month,
       COALESCE(SUM(amount) FILTER (WHERE (usage_hour AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date), 0) AS today,
       COALESCE(SUM(amount), 0) AS total
     FROM billing_usage WHERE ($2::text IS NULL OR region = $2)
       AND ($3::text IS NULL OR resource_id = $3)`,
    [period, region, resource],
  );
  data.month = money(result.rows[0].month);
  data.today = money(result.rows[0].today);
  data.total = money(result.rows[0].total);
}

export async function deriveResponse(client, request, response) {
  if (request.method !== "GET" || response.status >= 400) return response;
  const url = new URL(request.url);
  const path = url.pathname;
  const project = path.match(/^\/api\/projects\/([^/]+)\/summary$/);
  if (
    path !== "/api/overview" &&
    path !== "/api/quotas" &&
    path !== "/api/network/quotas" &&
    path !== "/api/billing/summary" &&
    !project
  )
    return response;
  const data = await response.json();
  if (path === "/api/network/quotas") {
    const result = await client.query(
      "SELECT region, metric, used_value FROM current_network_usage",
    );
    for (const quota of data) {
      quota.usedValue = result.rows
        .filter(
          (row) => row.region === quota.region && row.metric === quota.metric,
        )
        .reduce((sum, row) => sum + number(row.used_value), 0);
      quota.remaining = Math.max(0, quota.limitValue - quota.usedValue);
    }
  } else if (path === "/api/billing/summary") {
    await applyBilling(client, data, url);
  } else {
    const allocation = await allocations(client);
    if (path === "/api/quotas") applyQuotas(data, allocation);
    if (path === "/api/overview") {
      data.allocated = allocation.gpu.reduce(
        (sum, row) => sum + number(row.gpu_count),
        0,
      );
      for (const cell of data.distribution) {
        cell.gpuCount = allocation.gpu
          .filter((row) => row.region === cell.region && row.kind === cell.kind)
          .reduce((sum, row) => sum + number(row.gpu_count), 0);
      }
      applyQuotas(data.quotas, allocation);
      await applyBilling(client, data, url);
    }
    if (project) {
      data.gpuTotal = allocation.gpu
        .filter((row) => row.project_id === project[1])
        .reduce((sum, row) => sum + number(row.gpu_count), 0);
      applyQuotas(data.quotas, allocation);
      const cost = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS month FROM billing_usage
         WHERE project_id = $1 AND to_char(usage_hour AT TIME ZONE 'UTC', 'YYYY-MM') = $2`,
        [project[1], new Date().toISOString().slice(0, 7)],
      );
      data.monthCost = money(cost.rows[0].month);
    }
  }
  return Response.json(data, { status: response.status });
}
