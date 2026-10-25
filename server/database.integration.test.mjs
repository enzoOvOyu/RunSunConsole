import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

// Opt in inside the API container. Every write targets a disposable database.
test("PostgreSQL catalog, estimates and orders stay consistent", {
  skip: process.env.RUN_DATABASE_TESTS !== "1", timeout: 180_000,
}, async (t) => {
  const database = `runsun_verify_${process.pid}_${Date.now()}`;
  const admin = new pg.Client();
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const sql = new pg.Client({ database });
  let server;
  let output = "";
  t.after(async () => {
    if (server && server.exitCode === null) {
      const closed = once(server, "exit");
      server.kill("SIGTERM");
      await closed;
    }
    await sql.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  });
  await sql.connect();
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, PGDATABASE: database, PORT: "8082" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (data) => { output = (output + data).slice(-8000); });
  server.stderr.on("data", (data) => { output = (output + data).slice(-8000); });
  const base = "http://127.0.0.1:8082/api";
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (server.exitCode !== null) assert.fail(output);
    try { ready = (await fetch(base + "/health")).ok; } catch {}
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, output);
  const request = async (path, body, method = body ? "POST" : "GET") => {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", "X-Role": "owner" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const resources = (await request("/resources?region=jp&size=1000")).data.items;
  const inputs = Object.fromEntries(["gpu_vm", "gpu_baremetal", "vgpu", "inference"].map((kind) => {
    const source = resources.find((resource) => resource.kind === kind && resource.nodePool === "H100_SXM" && resource.spec.deploymentMode !== "slice");
    assert.ok(source, kind);
    const input = structuredClone(source);
    input.mode = "on_demand";
    input.spec.scaling = null;
    input.spec.gpuCount = 9999;
    if (kind === "gpu_vm") { input.spec.quantity = 3; input.spec.gpuPerInstance = 2; }
    if (kind === "gpu_baremetal") input.spec.machineCount = 2;
    if (kind === "vgpu") input.spec.nodePools = [{ ...input.spec.nodePools[0], poolCode: "H100_SXM", nodeCount: 2, gpuPerNode: 999 }];
    if (kind === "inference") { input.spec.replicas = 3; input.spec.gpuPerReplica = 2; }
    return [kind, input];
  }));
  await t.test("all four resource kinds recompute quantities and quote SQL rates", async () => {
    for (const [kind, expected] of [["gpu_vm", 6], ["gpu_baremetal", 2], ["vgpu", 16], ["inference", 6]]) {
      const result = await request("/deployment-orders/estimate", inputs[kind]);
      assert.equal(result.status, 200, JSON.stringify(result.data));
      const compute = result.data.lines.find((line) => line.key.startsWith("compute"));
      const rate = await sql.query("SELECT unit_price FROM billing_rates WHERE kind=$1 AND pool='H100_SXM' AND region='jp' AND unit=$2", [kind, compute.unit]);
      assert.equal(compute.quantity, expected);
      assert.equal(compute.unitPrice, Number(rate.rows[0].unit_price));
      assert.equal(result.data.spec.gpuCount, kind === "gpu_baremetal" ? 16 : expected);
    }
  });
  await t.test("SQL hardware and pricing changes reach estimates without a restart", async () => {
    await sql.query("UPDATE billing_rates SET unit_price=12.34 WHERE kind='gpu_vm' AND pool='H100_SXM' AND region='jp' AND unit='per_gpu_hour'");
    await sql.query("UPDATE billing_modes SET multiplier=0.25 WHERE mode='spot'");
    const quote = await request("/deployment-orders/estimate", { ...inputs.gpu_vm, mode: "spot" });
    assert.equal(quote.status, 200);
    assert.equal(quote.data.lines[0].unitPrice, 12.34 * 0.25);
    await sql.query("UPDATE node_pools SET gpus_per_node=4 WHERE code='H100_SXM'");
    const hardware = await request("/deployment-orders/estimate", inputs.gpu_baremetal);
    assert.equal(hardware.data.spec.gpuCount, 8);
    await sql.query("UPDATE node_pools SET gpus_per_node=8 WHERE code='H100_SXM'");
    const original = (await sql.query("SELECT data FROM deployment_configuration WHERE id=1")).rows[0].data;
    const changed = { ...original, serverFlavors: [{ vcpu: inputs.gpu_vm.spec.vcpu, memoryGb: 80 }] };
    await sql.query("UPDATE deployment_configuration SET data=$1 WHERE id=1", [changed]);
    assert.deepEqual((await request("/deployment-options?region=jp")).data.serverFlavors, changed.serverFlavors);
    const configured = await request("/deployment-orders/estimate", inputs.gpu_vm);
    assert.equal(configured.data.spec.memoryGb, inputs.gpu_vm.spec.memoryGb);
    await sql.query("UPDATE deployment_configuration SET data=$1 WHERE id=1", [original]);
  });
  await t.test("storage estimates and created volumes use database products", async () => {
    await sql.query("UPDATE storage_products SET usd_gb_month=0.37 WHERE kind='block' AND tier='essd_pl0'");
    const quote = await request("/storage/estimate", { selections: [{ key: "disk", kind: "block", tier: "essd_pl0", sizeGb: 100, count: 2 }] });
    assert.equal(quote.status, 200);
    assert.equal(quote.data[0].monthly, 74);
    const volume = await request("/storage/volumes", { name: "verify-volume", projectId: inputs.gpu_vm.projectId, region: "jp", kind: "block", tier: "essd_pl0", sizeGb: 100 });
    assert.equal(volume.status, 201, JSON.stringify(volume.data));
    assert.equal(volume.data.price_snapshot.monthly, 37);
    assert.equal((await sql.query("SELECT size_gb FROM storage_volumes WHERE id=$1", [volume.data.id])).rows[0].size_gb, 100);
    assert.equal((await request("/storage/estimate", { selections: [{ key: "disk", kind: "block", tier: "missing", sizeGb: 100, count: 2 }] })).status, 422);
  });
  await t.test("orders persist server quantities and release inventory on stop", async () => {
    const pools = (await request("/node-pools?region=jp")).data;
    const available = pools.find((pool) => pool.code === "H100_SXM").availableGpu;
    const input = structuredClone(inputs.gpu_vm);
    input.name = "verify-order";
    Object.assign(input.spec, { quantity: 2, gpuPerInstance: 1, gpuCount: 9999, publicIp: false, authMethod: "ssh_key", sshPubkey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO" });
    const created = await request("/deployment-orders", input);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const resource = created.data.resource;
    assert.equal(resource.spec.gpuCount, 2);
    assert.equal((await sql.query("SELECT gpu_count FROM resources WHERE id=$1", [resource.resourceUuid])).rows[0].gpu_count, 2);
    assert.equal(created.data.order.price_snapshot.lines[0].quantity, 2);
    assert.equal((await request("/node-pools?region=jp")).data.find((pool) => pool.code === "H100_SXM").availableGpu, available - 2);
    // Advance only the disposable database's provisioning clock.
    await sql.query("UPDATE resources SET data=jsonb_set(data, '{provisioningSince}', to_jsonb($2::text)) WHERE id=$1", [resource.resourceUuid, new Date(Date.now() - 60_000).toISOString()]);
    await sql.query("UPDATE app_state SET version=version+1 WHERE id=1");
    const stopped = await request(`/resources/${resource.resourceUuid}/stop`, {});
    assert.equal(stopped.status, 200);
    assert.equal((await request("/node-pools?region=jp")).data.find((pool) => pool.code === "H100_SXM").availableGpu, available);
  });
  await t.test("catalog writes commit before responding and empty catalogs do not fall back", async () => {
    const image = { id: "verify-image", name: "Verify image", type: "os" };
    const created = await request("/images", image);
    assert.equal(created.status, 201, JSON.stringify(created.data) + output);
    assert.deepEqual((await sql.query("SELECT data FROM images WHERE id=$1", [image.id])).rows[0].data, image);
    await sql.query("DELETE FROM images");
    assert.deepEqual((await request("/images")).data, []);
    assert.equal((await request("/deployment-orders/estimate", inputs.gpu_vm)).status, 422);
    await sql.query("DELETE FROM billing_rates WHERE kind='inference' AND pool='H100_SXM' AND region='jp'");
    assert.equal((await request("/deployment-orders/estimate", inputs.inference)).status, 422);
    for (const invalid of [-1, 0, 1.5, 100]) {
      const input = structuredClone(inputs.inference);
      input.spec.replicas = invalid;
      assert.equal((await request("/deployment-orders/estimate", input)).status, 422);
    }
  });
});
