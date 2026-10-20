import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { begin, loadState, migrate, pool, saveState } from "./database.mjs";

const vite = await createViteServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
});
const { db, makeDatabase } = await vite.ssrLoadModule(
  "/src/mocks/lib/database.ts",
);
const { handleMockRequest } = await vite.ssrLoadModule(
  "/src/mocks/handlers/index.ts",
);
await migrate();
let loadedVersion = -1;
const listeners = new Set();

async function initialize() {
  const client = await pool.connect();
  try {
    await begin(client);
    let loaded = await loadState(client);
    if (!loaded) {
      const seed = makeDatabase();
      await saveState(client, null, seed, 1);
      loaded = { version: 1, state: seed };
    }
    await client.query("COMMIT");
    Object.assign(db, loaded.state);
    loadedVersion = loaded.version;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
await initialize();

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

async function dispatch(request) {
  const client = await pool.connect();
  let before;
  try {
    await begin(client);
    const current = await client.query(
      "SELECT version FROM app_state WHERE id = 1",
    );
    if (Number(current.rows[0].version) !== loadedVersion) {
      const loaded = await loadState(client);
      Object.assign(db, loaded.state);
      loadedVersion = loaded.version;
    }
    before = structuredClone(db);
    const response = await handleMockRequest(request);
    if (response.status >= 400) {
      await client.query("ROLLBACK");
      Object.assign(db, before);
      return response;
    }
    if (JSON.stringify(before) !== JSON.stringify(db)) {
      const nextVersion = loadedVersion + 1;
      await saveState(client, before, db, nextVersion);
      await client.query("COMMIT");
      loadedVersion = nextVersion;
      broadcast(nextVersion);
    } else {
      await client.query("COMMIT");
    }
    return response;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (before) Object.assign(db, before);
    console.error("API transaction failed", error);
    return Response.json({ code: "INTERNAL" }, { status: 500 });
  } finally {
    client.release();
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
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
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
