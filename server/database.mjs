import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;
export const pool = new Pool({
  host: process.env.PGHOST || "db",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "runsun",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "runsun",
  max: 8,
});

let resourceAllocation = () => ({ vcpu: 0, memory: 0 });
export function setResourceAllocationDeriver(derive) {
  resourceAllocation = derive;
}

const tables = [
  { table: "projects", path: "projects", id: "id", fields: {} },
  {
    table: "resources",
    path: "resources",
    id: "resourceUuid",
    fields: {
      project_id: "projectId",
      region: "region",
      kind: "kind",
      status: "status",
      gpu_count: (item) => item.spec.gpuCount,
      vcpu_count: (item) => resourceAllocation(item).vcpu,
      memory_gb: (item) => resourceAllocation(item).memory,
      deleted_at: "deletedAt",
    },
  },
  {
    table: "storage_volumes",
    path: "volumes",
    id: "id",
    fields: {
      project_id: "projectId",
      resource_id: "resourceUuid",
      region: "region",
      kind: "kind",
      size_gb: "sizeGb",
      deleted_at: "deletedAt",
    },
  },
  {
    table: "storage_buckets",
    path: "buckets",
    id: "id",
    fields: {
      project_id: (item) => item.projectId || "default",
      resource_id: (item) => item.attachedResourceUuid || null,
      region: "region",
      quota_gb: "quotaGb",
    },
  },
  {
    table: "network_vpcs",
    path: "network.vpcs",
    id: "id",
    fields: { project_id: "projectId", region: "region" },
  },
  {
    table: "network_subnets",
    path: "network.subnets",
    id: "id",
    fields: { project_id: "projectId", vpc_id: "vpcId", region: "region" },
  },
  {
    table: "network_security_groups",
    path: "network.groups",
    id: "id",
    fields: { project_id: "projectId", vpc_id: "vpcId", region: "region" },
  },
  {
    table: "network_interfaces",
    path: "network.interfaces",
    id: "id",
    fields: {
      project_id: "projectId",
      resource_id: "resourceUuid",
      vpc_id: "vpcId",
      subnet_id: "subnetId",
      region: "region",
      private_ip: "privateIp",
      released_at: "releasedAt",
    },
  },
  {
    table: "network_eips",
    path: "network.eips",
    id: "id",
    fields: {
      project_id: "projectId",
      region: "region",
      address: "address",
      interface_id: "interfaceId",
      released_at: "releasedAt",
    },
  },
  {
    table: "network_tunnels",
    path: "network.tunnels",
    id: "id",
    fields: {
      project_id: "projectId",
      region: "region",
      vpc_id: "vpcId",
      subnet_id: "subnetId",
      eip_id: "eipId",
    },
  },
  {
    table: "deployment_orders",
    path: "orders",
    id: "orderUuid",
    fields: { project_id: "projectId", resource_id: "resourceUuid" },
  },
  {
    table: "billing_usage",
    path: "usage",
    id: "id",
    orderBy: "usage_hour, id",
    chunk: 2000,
    fields: {
      project_id: "projectId",
      region: "region",
      resource_id: "resourceUuid",
      amount: "amount",
      usage_hour: "usageHour",
    },
  },
  {
    table: "billing_invoices",
    path: "invoices",
    id: "id",
    fields: { billing_period: "period", amount: "amount" },
  },
  {
    table: "billing_transactions",
    path: "transactions",
    id: "id",
    orderBy: "at, id",
    fields: { resource_id: "resourceUuid", amount: "amount", at: "at" },
  },
];

const get = (state, path) =>
  path.split(".").reduce((value, key) => value[key], state);
const set = (state, path, value) => {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((result, key) => result[key], state);
  parent[keys.at(-1)] = value;
};
const projection = (item, selector) =>
  typeof selector === "function" ? selector(item) : (item[selector] ?? null);

function auxiliary(state) {
  const rest = structuredClone(state);
  for (const config of tables) set(rest, config.path, []);
  delete rest.sliceInventory;
  return rest;
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
    for (const name of readdirSync(dir)
      .filter((item) => item.endsWith(".sql"))
      .sort()) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(728154092)");
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE name = $1",
          [name],
        );
        if (!applied.rowCount) {
          await client.query(readFileSync(join(dir, name), "utf8"));
          await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
            name,
          ]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

export async function loadState(client) {
  const meta = await client.query(
    "SELECT version, auxiliary FROM app_state WHERE id = 1",
  );
  if (!meta.rowCount) return null;
  const state = meta.rows[0].auxiliary;
  for (const config of tables) {
      if (!config.chunk) {
        const result = await client.query(
          `SELECT data FROM ${config.table} ORDER BY ${config.orderBy || "id"}`,
        );
        set(state, config.path, result.rows.map((row) => row.data));
        continue;
      }
      const items = [];
      let after = null;
      for (;;) {
        const result = await client.query(
          `SELECT data FROM ${config.table}
           ${after === null ? "" : `WHERE (${config.orderBy}) > (${after.map((_, i) => `$${i + 1}`).join(", ")})`}
           ORDER BY ${config.orderBy} LIMIT ${config.chunk}`,
          after === null ? [] : after,
        );
        if (!result.rows.length) break;
        for (const row of result.rows) items.push(row.data);
        const last = result.rows.at(-1).data;
        after = config.orderBy.split(",").map((column) => {
          const key = column.trim();
          if (key === "id") return last.id;
          if (key === "usage_hour") return last.usageHour;
          return last[key];
        });
      }
        set(state, config.path, items);
  }
  const slices = await client.query(
    "SELECT id, region, sku_id, layout_id, physical_gpu_id, state, resource_id FROM slice_inventory ORDER BY id",
  );
  state.sliceInventory = slices.rows.map((row) => ({
    id: row.id,
    region: row.region,
    skuId: row.sku_id,
    layoutId: row.layout_id,
    physicalGpuId: row.physical_gpu_id,
    state: row.state,
    resourceUuid: row.resource_id,
  }));
  return { version: Number(meta.rows[0].version), state };
}

export async function saveState(client, before, after, version) {
  for (const config of tables) {
    const oldRows = new Map(
      (before ? get(before, config.path) : []).map((row) => [
        String(row[config.id]),
        row,
      ]),
    );
    const newRows = new Map(
      get(after, config.path).map((row) => [String(row[config.id]), row]),
    );
    for (const [id, row] of newRows) {
      if (JSON.stringify(oldRows.get(id)) === JSON.stringify(row)) continue;
      const fields = Object.keys(config.fields);
      const columns = ["id", ...fields, "data"];
      const values = [
        id,
        ...fields.map((field) => projection(row, config.fields[field])),
        JSON.stringify(row),
      ];
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      const update = columns
        .slice(1)
        .map((column) => `${column} = EXCLUDED.${column}`)
        .join(", ");
      await client.query(
        `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})
         ON CONFLICT (id) DO UPDATE SET ${update}`,
        values,
      );
    }
    for (const id of oldRows.keys())
      if (!newRows.has(id))
        await client.query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
  }
  await client.query(
    `INSERT INTO app_state(id, version, auxiliary) VALUES(1, $1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, auxiliary = EXCLUDED.auxiliary`,
    [version, JSON.stringify(auxiliary(after))],
  );
  const oldSlices = new Map((before?.sliceInventory || []).map((item) => [item.id, item]));
  const newSlices = new Map((after.sliceInventory || []).map((item) => [item.id, item]));
  for (const [id, item] of newSlices) {
    if (JSON.stringify(oldSlices.get(id)) === JSON.stringify(item)) continue;
    await client.query(
      `INSERT INTO slice_inventory(id, region, sku_id, layout_id, physical_gpu_id, state, resource_id, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, sku_id=EXCLUDED.sku_id,
         layout_id=EXCLUDED.layout_id, physical_gpu_id=EXCLUDED.physical_gpu_id,
         state=EXCLUDED.state, resource_id=EXCLUDED.resource_id, updated_at=now()`,
      [item.id, item.region, item.skuId, item.layoutId, item.physicalGpuId, item.state, item.resourceUuid],
    );
  }
  for (const id of oldSlices.keys())
    if (!newSlices.has(id))
      await client.query("DELETE FROM slice_inventory WHERE id = $1", [id]);
}

export async function begin(client) {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(728154093)");
}
