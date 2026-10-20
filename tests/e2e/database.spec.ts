import { test, expect } from "@playwright/test";

test.skip(
  !process.env.RUNSUN_DB_E2E,
  "Requires the PostgreSQL API test environment",
);

test("database-backed console pages load their existing API contracts", async ({
  page,
}) => {
  test.setTimeout(90000);
  for (const route of [
    "overview",
    "resources/servers",
    "resources/baremetal",
    "resources/vgpu",
    "resources/inference",
    "ops/projects",
    "ops/quotas",
    "storage/block",
    "storage/file",
    "storage/object",
    "network/vpcs",
    "network/eips",
    "network/security-groups",
    "network/tunnels",
    "billing/cost",
    "billing/bills",
  ]) {
    await page.goto(`/${route}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("服务暂时不可用");
  }
  const health = await page.evaluate(
    async () =>
      (await (await fetch("/api/health")).json()) as { status: string },
  );
  expect(health.status).toBe("ok");
});

test("storage allocation changes reach another browser and stay consistent with quotas", async ({
  browser,
}) => {
  const owner = await browser.newContext();
  const observer = await browser.newContext();
  const first = await owner.newPage();
  const second = await observer.newPage();
  await Promise.all([
    first.goto("/ops/quotas?region=jp"),
    second.goto("/ops/quotas?region=jp"),
  ]);
  await expect(first.locator("h1")).toBeVisible();
  await expect(second.locator("h1")).toBeVisible();
  const before = await second.evaluate(async () => {
    const quotas = (await (await fetch("/api/quotas?region=jp")).json()) as {
      metric: string;
      usedValue: number;
    }[];
    return quotas.find((quota) => quota.metric === "storage")!.usedValue;
  });
  await second.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const stream = new EventSource("/api/events/stream");
        const timer = setTimeout(
          () => reject(new Error("Event stream did not connect")),
          10000,
        );
        stream.addEventListener("connected", () => {
          clearTimeout(timer);
          (window as unknown as { dbTestStream: EventSource }).dbTestStream =
            stream;
          resolve();
        });
      }),
  );
  const event = second.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const stream = (window as unknown as { dbTestStream: EventSource })
          .dbTestStream;
        const timer = setTimeout(
          () => reject(new Error("No database event received")),
          10000,
        );
        stream.addEventListener(
          "change",
          (message) => {
            clearTimeout(timer);
            stream.close();
            resolve(
              JSON.parse((message as MessageEvent).data).version as number,
            );
          },
          { once: true },
        );
      }),
  );
  let volumeId = "";
  try {
    const created = await first.evaluate(async () => {
      const response = await fetch("/api/storage/volumes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Role": "owner" },
        body: JSON.stringify({
          name: `browser-db-${Date.now()}`,
          kind: "block",
          tier: "essd_pl1",
          sizeGb: 100,
          projectId: "default",
          region: "jp",
        }),
      });
      return {
        status: response.status,
        body: (await response.json()) as { id: string },
      };
    });
    expect(created.status).toBe(201);
    volumeId = created.body.id;
    expect(await event).toBeGreaterThan(0);
    const after = await second.evaluate(async () => {
      const quotas = (await (await fetch("/api/quotas?region=jp")).json()) as {
        metric: string;
        usedValue: number;
      }[];
      return quotas.find((quota) => quota.metric === "storage")!.usedValue;
    });
    expect(after).toBe(before + 100);
  } finally {
    if (volumeId) {
      const response = await first.evaluate(
        async (id) =>
          fetch(`/api/storage/volumes/${id}`, {
            method: "DELETE",
            headers: { "X-Role": "owner" },
          }).then((result) => result.status),
        volumeId,
      );
      expect(response).toBe(204);
    }
    await owner.close();
    await observer.close();
  }
});

test("resource creation and deletion update overview, project and quota from one database record", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/deployment/server");
  const before = await page.evaluate(async () => {
    const overview = await (await fetch("/api/overview")).json() as { allocated: number };
    const quotas = await (await fetch("/api/quotas?region=jp")).json() as { metric: string; usedValue: number }[];
    const project = await (await fetch("/api/projects/default/summary")).json() as { gpuTotal: number };
    return { overview: overview.allocated, quota: quotas.find((row) => row.metric === "gpu")!.usedValue, project: project.gpuTotal };
  });
  let resourceId = "";
  let displayId = "";
  try {
    for (let step = 0; step < 3; step++)
      await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("textbox", { name: "SSH 公钥", exact: true }).fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByLabel("我已阅读并确认配置与计费方式").check();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await expect(page).toHaveURL(/resources\/servers\?drawer=/);
    resourceId = new URL(page.url()).searchParams.get("drawer") || "";
    const resource = await page.evaluate(async (id) => {
      const response = await fetch(`/api/resources/${id}`);
      return response.json() as Promise<{ displayId: string; spec: { gpuCount: number } }>;
    }, resourceId);
    displayId = resource.displayId;
    expect(resource.spec.gpuCount).toBeGreaterThan(0);
    const after = await page.evaluate(async () => {
      const overview = await (await fetch("/api/overview")).json() as { allocated: number };
      const quotas = await (await fetch("/api/quotas?region=jp")).json() as { metric: string; usedValue: number }[];
      const project = await (await fetch("/api/projects/default/summary")).json() as { gpuTotal: number };
      return { overview: overview.allocated, quota: quotas.find((row) => row.metric === "gpu")!.usedValue, project: project.gpuTotal };
    });
    expect(after.overview - before.overview).toBe(resource.spec.gpuCount);
    expect(after.quota - before.quota).toBe(resource.spec.gpuCount);
    expect(after.project - before.project).toBe(resource.spec.gpuCount);
  } finally {
    if (resourceId && displayId) {
      const status = await page.evaluate(async ({ id, confirm }) =>
        (await fetch(`/api/resources/${id}?confirm=${encodeURIComponent(confirm)}`, {
          method: "DELETE",
          headers: { "X-Role": "owner" },
        })).status,
      { id: resourceId, confirm: displayId });
      expect(status).toBe(200);
    }
  }
  const restored = await page.evaluate(async () => {
    const overview = await (await fetch("/api/overview")).json() as { allocated: number };
    const quotas = await (await fetch("/api/quotas?region=jp")).json() as { metric: string; usedValue: number }[];
    const project = await (await fetch("/api/projects/default/summary")).json() as { gpuTotal: number };
    return { overview: overview.allocated, quota: quotas.find((row) => row.metric === "gpu")!.usedValue, project: project.gpuTotal };
  });
  expect(restored).toEqual(before);
});
