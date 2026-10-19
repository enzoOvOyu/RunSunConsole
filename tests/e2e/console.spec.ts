import { test, expect } from "@playwright/test";
const routes = [
  "overview",
  "resources/servers",
  "resources/baremetal",
  "resources/vgpu",
  "resources/inference",
  "deployment/server",
  "deployment/baremetal",
  "deployment/vgpu",
  "deployment/inference",
  "ops/projects",
  "ops/quotas",
  "ops/cost",
  "ops/tickets",
  "workbench/notebooks",
  "workbench/images",
  "workbench/apps",
  "workbench/scaling",
  "data/datasets",
  "data/storage",
  "data/pipelines",
  "billing/bills",
  "billing/vouchers",
];
test("all navigation pages load without runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of routes) {
    await page.goto("/" + route);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("服务暂时不可用");
    await expect(page.locator("main")).not.toContainText("资源已不存在");
  }
  expect(errors).toEqual([]);
});
test("aggregate, locale, theme, commands and responsive navigation", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page.getByText("1,040", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Overview");
  await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder("Type a name, ID or page…")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("aside")).toBeVisible();
  await page.screenshot({ path: "/tmp/runsuncos-mobile.png", fullPage: true });
});
test("independent resource drawers support billing and history tabs", async ({
  page,
}) => {
  for (const route of ["servers", "baremetal", "vgpu", "inference"]) {
    await page.goto("/resources/" + route);
    await page.locator("tbody tr").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("tab", { name: "计费", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "用量明细", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
test("server wizard creates a resource and preserves it after refresh", async ({
  page,
}) => {
  await page.goto("/deployment/server");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page
    .getByLabel("SSH 公钥")
    .fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("我已阅读并确认配置与计费方式").check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page).toHaveURL(/resources\/servers\?drawer=/);
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("dialog")).toContainText("供给中");
  const bytes = await page.evaluate(
    () => localStorage.getItem("rs.mock.database.v2")?.length || 0,
  );
  expect(bytes).toBeGreaterThan(100);
  expect(bytes).toBeLessThan(4_500_000);
});
test("viewer cannot start, stop, delete or deploy resources", async ({
  page,
}) => {
  await page.goto("/resources/servers");
  await page.getByRole("button", { name: "账号与组织", exact: true }).click();
  await page.getByLabel("切换角色视图").selectOption("viewer");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "新建", exact: true }),
  ).toBeDisabled();
  await page.locator("tbody tr").first().click();
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "删除", exact: true }),
  ).toBeDisabled();
});
test("project, dataset, object and pipeline workflows persist changes", async ({
  page,
}) => {
  await page.goto("/ops/projects");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByLabel("项目名称").fill("Review Project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "新建", exact: true })
    .click();
  await expect(page.getByText("Review Project", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Review Project", { exact: true })).toBeVisible();
  await page.goto("/data/datasets");
  await page.getByRole("cell", { name: "多语种指令集", exact: true }).click();
  await page.getByRole("tab", { name: "数据预览 · 前 50 行" }).click();
  await expect(page.getByRole("dialog").locator("table")).toBeVisible();
  await page.goto("/data/storage");
  await page.locator("tbody tr").first().click();
  await page.getByRole("button", { name: /models\// }).click();
  await page.getByRole("button", { name: /llama\// }).click();
  await expect(
    page.getByText("models/llama/config.json", { exact: true }),
  ).toBeVisible();
  await page.goto("/data/pipelines");
  await page.locator("tbody tr").first().click();
  await expect(page.locator(".dag-canvas")).toBeVisible();
  await page.getByRole("button", { name: "MinHash", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "节点配置", exact: true }),
  ).toBeVisible();
});
test("bare metal, vGPU and inference wizards create distinct resource types", async ({
  page,
}) => {
  for (const [wizard, route] of [
    ["baremetal", "baremetal"],
    ["vgpu", "vgpu"],
    ["inference", "inference"],
  ]) {
    await page.goto("/deployment/" + wizard);
    for (let i = 0; i < 4; i++)
      await page.getByRole("button", { name: "下一步", exact: true }).click();
    if (wizard === "baremetal")
      await page
        .getByLabel("SSH 公钥")
        .fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO");
    await page.getByLabel("我已阅读并确认配置与计费方式").check();
    await page.getByRole("button", { name: "新建", exact: true }).click();
    if (wizard === "inference") {
      await expect(
        page.getByRole("heading", { name: "新凭据仅展示一次，请妥善保存" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    }
    await expect(page).toHaveURL(
      new RegExp("resources/" + route + "\\?drawer="),
    );
    await expect(page.getByRole("dialog")).toBeVisible();
  }
});
test("locale changes preserve an in-progress form and do not reload its queries", async ({
  page,
}) => {
  await page.goto("/deployment/server");
  await page.locator('input[name="name"]').fill("locale-preserved");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  let refetches = 0;
  page.on("request", (r) => {
    if (
      r.url().includes("/api/node-pools") ||
      r.url().includes("/api/projects")
    )
      refetches++;
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Instance specification", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue(
    "locale-preserved",
  );
  expect(refetches).toBe(0);
});
test("resource deletion requires typed confirmation and keeps read-only history", async ({
  page,
}) => {
  await page.goto("/resources/servers?region=th");
  await expect(
    page.getByRole("combobox", { name: "区域", exact: true }),
  ).toHaveValue("th");
  await page.locator("tbody tr").first().click();
  const displayId = (await page
    .getByRole("dialog")
    .locator(".dialog-description")
    .textContent())!.split(" · ")[0];
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "删除", exact: true })
    .click();
  const confirmation = page.getByRole("dialog").last();
  await expect(
    confirmation.getByRole("button", { name: "删除", exact: true }),
  ).toBeDisabled();
  await confirmation.getByRole("textbox").fill(displayId);
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(
    page.getByText("删除请求已受理，资源正在回收", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tbody")).not.toContainText(displayId);
  await page.getByLabel("显示已释放").check();
  await page.getByText(displayId, { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已释放资源 · 只读历史");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }),
  ).toHaveCount(0);
});
