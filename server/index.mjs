import { createServer as createHttpServer } from "node:http";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";
import {
  begin,
  loadState,
  migrate,
  pool,
  saveState,
  setResourceAllocationDeriver,
} from "./database.mjs";
import { deriveResponse } from "./derived.mjs";
import { catalogSeed, loadCatalog, seedCatalog } from "./catalog.mjs";
const gzipAsync = promisify(gzip);

const vite = await createViteServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
const { db, makeDatabase, normalizeDisplayIds, setPersistHook } = await vite.ssrLoadModule(
  "/src/mocks/lib/database.ts",
);
let dirty = false;
setPersistHook(() => {
  dirty = true;
});
const { quotaUse, provisioningSeconds } = await vite.ssrLoadModule("/src/mocks/lib/derive.ts");
const { reconcileSliceInventory } = await vite.ssrLoadModule("/src/mocks/fixtures/slices.ts");
setResourceAllocationDeriver((resource) => {
  const active = { ...resource, status: "running", deletedAt: null };
  return { vcpu: quotaUse(active, "vcpu"), memory: quotaUse(active, "memory") };
});
const { handleMockRequest } = await vite.ssrLoadModule(
  "/src/mocks/handlers/index.ts",
);
const { objectStoreSnapshot, loadObjectStore } = await vite.ssrLoadModule(
  "/src/mocks/lib/object-store.ts",
);
const pricing = await vite.ssrLoadModule("/src/mocks/fixtures/pricing.ts");
const gpuSpecs = await vite.ssrLoadModule("/src/mocks/fixtures/gpu-specs.ts");
const slices = await vite.ssrLoadModule("/src/mocks/fixtures/slices.ts");
const storage = await vite.ssrLoadModule("/src/lib/storage.ts");

function applyCatalog(catalog) {
  pricing.setRates(catalog.rates);
  gpuSpecs.setGpuCatalog(catalog.pools, catalog.supply);
  storage.setStorageProducts(catalog.storageProducts);
  slices.setSliceSkus(catalog.sliceSkus);
}

function defaultCatalog() {
  const { specs, supply } = gpuSpecs.gpuCatalogSnapshot();
  return catalogSeed({
    rates: pricing.RATES,
    pools: specs,
    supply,
    storageProducts: storage.STORAGE_PRODUCTS,
    sliceSkus: slices.SLICE_SKUS,
    sliceInventory: slices.seedSliceInventory(),
  });
}
await migrate();
let loadedVersion = -1;
let lastMeteredAt = 0;
const listeners = new Set();
let provisioningTimer;

function scheduleProvisioning() {
  clearTimeout(provisioningTimer);
  const deadlines = db.resources
    .filter((resource) => !resource.deletedAt && resource.status === "provisioning")
    .map(
      (resource) =>
        Date.parse(resource.provisioningSince || resource.createdAt) +
        provisioningSeconds(resource, db.models) * 1000,
    )
    .filter(Number.isFinite);
  if (!deadlines.length) return;
  const delay = Math.max(1000, Math.min(...deadlines) - Date.now());
  provisioningTimer = setTimeout(async () => {
    try {
      await dispatch(new Request("http://localhost/api/account"));
    } catch (error) {
      console.error("Provisioning refresh failed", error);
    } finally {
      scheduleProvisioning();
    }
  }, delay);
}

async function initialize() {
  const client = await pool.connect();
  try {
    await seedCatalog(client, defaultCatalog());
    await begin(client);
    let loaded = await loadState(client);
    if (!loaded) {
      const seed = makeDatabase();
      seed.objectContent = [];
      await saveState(client, null, seed, 1);
      loaded = { version: 1, state: seed };
    } else {
      const missing = await client.query(
        "SELECT 1 FROM resources WHERE gpu_count > 0 AND vcpu_count = 0 LIMIT 1",
      );
      if (missing.rowCount) {
        const before = { ...loaded.state, resources: [] };
        await saveState(client, before, loaded.state, loaded.version + 1);
        loaded.version++;
      }
      const beforeUpgrade = structuredClone(loaded.state);
      loaded.state.sliceInventory = reconcileSliceInventory(loaded.state.sliceInventory);
      const idsChanged = normalizeDisplayIds(loaded.state);
      if (idsChanged || JSON.stringify(beforeUpgrade.sliceInventory) !== JSON.stringify(loaded.state.sliceInventory)) {
        await saveState(client, beforeUpgrade, loaded.state, loaded.version + 1);
        loaded.version++;
      }
    }
    await client.query("COMMIT");
    applyCatalog(await loadCatalog(client));
    Object.assign(db, loaded.state);
    loadObjectStore(db.objectContent || []);
    loadedVersion = loaded.version;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
await initialize();
await dispatch(new Request("http://localhost/api/account"));
scheduleProvisioning();

function broadcast(version) {
  for (const response of listeners) {
    try {
      response.write(
        `id: ${version}\nevent: change\ndata: ${JSON.stringify({ version })}\n\n`,
      );
    } catch {
      listeners.delete(response);
    }
  }
}

function sameState(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(b, key) || !sameState(a[key], b[key])) return false;
  }
  return true;
}

async function dispatch(request) {
  const path = new URL(request.url).pathname;
  const estimateOnly = path === "/api/deployment-orders/estimate";
  const settleBilling = estimateOnly
    ? false
    : request.method !== "GET" || Date.now() - lastMeteredAt >= 60_000;
  const pureRead = request.method === "GET" || path === "/api/deployment-orders/estimate";
  const fastRead = pureRead && !settleBilling &&
    !db.account.depletedAt && db.account.creditBalance >= 0 &&
    !db.resources.some((resource) => resource.status === "provisioning" ||
      (resource.kind === "vgpu" && resource.spec.deploymentMode === "slice" && resource.status === "error")) &&
    !["/api/billing/report", "/api/billing/invoices"].includes(path);
  if (fastRead) {
    let fallback = false;
    try {
      const current = await pool.query("SELECT version FROM app_state WHERE id = 1");
      if (Number(current.rows[0].version) === loadedVersion) {
        dirty = false;
        const response = await handleMockRequest(request, { delayMs: 0, settleBilling });
        if (!dirty) return await deriveResponse(pool, request, response);
        fallback = true;
      }
    } catch (error) {
      console.error("Read-only request failed; reloading database state", error);
      fallback = true;
    }
    if (fallback) {
      const reloadClient = await pool.connect();
      try {
        await begin(reloadClient);
        const loaded = await loadState(reloadClient);
        if (loaded) {
          Object.assign(db, loaded.state);
          loadObjectStore(db.objectContent || []);
          loadedVersion = loaded.version;
          dirty = false;
        }
        await reloadClient.query("COMMIT");
      } catch (error) {
        await reloadClient.query("ROLLBACK").catch(() => {});
        console.error("Database reload failed", error);
        return Response.json({ code: "INTERNAL" }, { status: 500 });
      } finally {
        reloadClient.release();
      }
    }
  }
  const client = await pool.connect();
  let before;
  let committed = false;
  try {
    await begin(client);
    const current = await client.query("SELECT version FROM app_state WHERE id = 1");
    let version = Number(current.rows[0].version);
    let reload = false;
    if (version !== loadedVersion) {
      const loaded = await loadState(client);
      Object.assign(db, loaded.state);
      loadObjectStore(db.objectContent || []);
      loadedVersion = loaded.version;
      version = loaded.version;
      applyCatalog(await loadCatalog(client));
      reload = true;
    }
    db.objectContent = objectStoreSnapshot();
    before = structuredClone(db);
    dirty = false;
    const response = await handleMockRequest(request, {
      delayMs: 0,
      settleBilling,
    });
    if (settleBilling && response.status < 400) lastMeteredAt = Date.now();
    db.objectContent = objectStoreSnapshot();
    if (response.status >= 400) {
      await client.query("ROLLBACK");
      Object.assign(db, before);
      loadObjectStore(db.objectContent || []);
      return response;
    }
    const changed = dirty || !sameState(before, db);
    if (changed) await saveState(client, before, db, version + 1);
    const derivedResponse = await deriveResponse(client, request, response);
    await client.query("COMMIT");
    committed = true;
    if (changed) {
      loadedVersion = version + 1;
      // Metering advances during reads; broadcasting those writes would make
      // each cache refresh trigger another refresh without a user action.
      if (
        (request.method !== "GET" || dirty) &&
        path !== "/api/deployment-orders/estimate"
      ) {
        const version = loadedVersion;
        setTimeout(() => broadcast(version), 100);
      }
    }
    if (reload && !changed) loadedVersion = version;
    return derivedResponse;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    if (!committed && before) {
      Object.assign(db, before);
      loadObjectStore(db.objectContent || []);
    }
    console.error("API transaction failed", error);
    return Response.json({ code: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
    if (request.method !== "GET") scheduleProvisioning();
  }
}

const server = createHttpServer(async (incoming, outgoing) => {
  const path = new URL(incoming.url || "/", "http://localhost").pathname;
  if (path === "/api/health") {
    outgoing.writeHead(200, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ status: "ok", version: loadedVersion }));
    return;
  }
  if (path === "/api/events/stream") {
    outgoing.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    outgoing.write(
      `event: connected\ndata: ${JSON.stringify({ version: loadedVersion })}\n\n`,
    );
    listeners.add(outgoing);
    const heartbeat = setInterval(
      () => outgoing.write(": heartbeat\n\n"),
      15000,
    );
    incoming.on("close", () => {
      clearInterval(heartbeat);
      listeners.delete(outgoing);
    });
    return;
  }
  if (!path.startsWith("/api/")) {
    outgoing.writeHead(404);
    outgoing.end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const url = new URL(incoming.url, "http://localhost:8080");
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await dispatch(request);
    const body = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers);
    const acceptsGzip = /\bgzip\b/.test(incoming.headers["accept-encoding"] || "");
    if (acceptsGzip && body.length > 1024 && !headers["content-encoding"]) {
      const compressed = await gzipAsync(body, { level: 4 });
      headers["content-encoding"] = "gzip";
      headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : "Accept-Encoding";
      headers["content-length"] = String(compressed.length);
      outgoing.writeHead(response.status, headers);
      outgoing.end(compressed);
      return;
    }
    headers["content-length"] = String(body.length);
    outgoing.writeHead(response.status, headers);
    outgoing.end(body);
  } catch (error) {
    console.error("HTTP request failed", error);
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ code: "INTERNAL" }));
  }
});
const port = Number(process.env.PORT || 8080);
server.listen(port, "0.0.0.0", () =>
  console.log(`RunSun API listening on ${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    server.close();
    await vite.close();
    await pool.end();
    process.exit(0);
  });
