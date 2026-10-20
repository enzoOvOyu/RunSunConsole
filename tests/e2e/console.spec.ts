import { test, expect, type Page } from "@playwright/test";
async function expectOverviewAllocation(page: Page) {
  await expect(page.locator(".overview-stats .stat")).toHaveCount(4);
  const allocated = await page.evaluate(async () => {
    const quotas = (await (await fetch("/api/quotas")).json()) as {
      metric: string;
      usedValue: number;
    }[];
    return quotas
      .filter((quota) => quota.metric === "gpu")
      .reduce((sum, quota) => sum + quota.usedValue, 0);
  });
  await expect(
    page
      .locator(".overview-stats")
      .getByText(allocated.toLocaleString("en-US"), { exact: true }),
  ).toBeVisible();
  return allocated;
}
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
  "network/vpcs",
  "network/eips",
  "network/security-groups",
  "network/tunnels",
  "ops/projects",
  "ops/quotas",
  "billing/cost",
  "ops/tickets",
  "workbench/notebooks",
  "workbench/images",
  "workbench/apps",
  "workbench/scaling",
  "data/datasets",
  "storage/block",
  "storage/file",
  "storage/object",
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
test("overview groups allocated GPU models across every region", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page.getByText("GPU 型号与已分配量")).toBeVisible();
  await expect(page.locator(".overview-gpu-row")).toHaveCount(5);
  await expect(page.locator(".overview-gpu-legend")).toContainText("JP");
  await expect(page.locator(".overview-gpu-legend")).toContainText("SG");
  await expect(page.locator(".overview-gpu-legend")).toContainText("US");
  const counts = await page
    .locator(".overview-gpu-row .mono")
    .allTextContents();
  expect(
    counts.reduce((sum, label) => sum + Number(label.replace(/\D/g, "")), 0),
  ).toBe(await expectOverviewAllocation(page));
  await expect(page.getByText("近 7 日费用变化")).toHaveCount(0);
});
test("submenu pages describe their own resource and billing functions", async ({
  page,
}) => {
  const pages = [
    [
      "resources/servers",
      "查看云服务器实例的状态、规格和网络配置，并进行启停与资源管理。",
    ],
    ["resources/baremetal", "按集群查看裸金属设备明细、运行状态和分配情况。"],
    [
      "resources/vgpu",
      "查看 GPU 集群、节点池和共享资源状态，管理集群生命周期。",
    ],
    [
      "resources/inference",
      "查看推理服务部署、模型副本与服务状态，管理服务运行配置。",
    ],
    ["ops/projects", "查看项目资源、成员权限、配额与费用归属"],
    ["ops/quotas", "查看当前区域的算力、内存、存储和网络配额用量及可用额度。"],
    ["ops/tickets", "提交资源与平台问题，跟踪工单处理状态并补充沟通记录。"],
    [
      "workbench/notebooks",
      "在已运行的计算资源上创建并管理 Notebook 与 IDE 连接。",
    ],
    [
      "workbench/images",
      "浏览模型目录与系统镜像，按发布方、参数量、模态和可部署状态筛选。",
    ],
    [
      "workbench/apps",
      "浏览预置 AI 应用模板，查看所需资源并进入对应部署流程。",
    ],
    [
      "workbench/scaling",
      "为计算资源配置自动伸缩规则，查看策略状态和伸缩事件。",
    ],
    ["billing/cost", "按项目、资源、区域或资源类型分析用量费用，并设置预算。"],
    [
      "billing/bills",
      "查看账单用量、交易流水、发票和账户余额，按账期核对费用。",
    ],
    ["billing/vouchers", "查看代金券面值、余额、适用范围、有效期与使用状态。"],
  ];
  for (const [route, description] of pages) {
    await page.goto(`/${route}`);
    await expect(page.locator(".page-header p")).toHaveText(description);
  }
});
test("aggregate, locale, theme, commands and responsive navigation", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
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
    .getByRole("textbox", { name: "SSH 公钥", exact: true })
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
        .getByRole("textbox", { name: "SSH 公钥", exact: true })
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
  await page.goto("/resources/servers?region=jp");
  await expect(
    page.getByRole("combobox", { name: "区域", exact: true }),
  ).toHaveValue("jp");
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
test("runtime diagnostics and replica restart persist across refresh", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
  const resources = await page.evaluate(
    async () =>
      (await (await fetch("/api/resources?size=1000")).json()).items as {
        kind: string;
        resourceUuid: string;
        region: string;
        status: string;
      }[],
  );
  for (const [kind, route, tab, heading] of [
    ["gpu_baremetal", "baremetal", "硬件监控", "GPU 硬件健康"],
    ["vgpu", "vgpu", "控制面", "控制面组件"],
  ]) {
    const r = resources.find((r) => r.kind === kind && r.status === "running")!;
    await page.goto(
      `/resources/${route}?drawer=${r.resourceUuid}&region=${r.region}`,
    );
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText(
      "hardware.gpuHealth",
    );
  }
  const r = resources.find(
    (r) => r.kind === "inference" && r.status === "running",
  )!;
  await page.goto(
    `/resources/inference?drawer=${r.resourceUuid}&region=${r.region}`,
  );
  const readRestarts = () =>
    page.evaluate(
      async (uuid) =>
        (await (await fetch(`/api/metrics/inference/${uuid}/replicas`)).json())
          .replicas[0].restarts as number,
      r.resourceUuid,
    );
  await expect(
    page.getByRole("heading", { name: "实例管理", exact: true }),
  ).toBeVisible();
  const before = await readRestarts();
  await page
    .getByRole("dialog")
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "重启", exact: true })
    .click();
  await expect.poll(readRestarts).toBe(before + 1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "实例管理", exact: true }),
  ).toBeVisible();
  expect(await readRestarts()).toBe(before + 1);
});
test("password login never stores the secret in a wizard draft", async ({
  page,
}) => {
  await page.goto("/deployment/server");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("登录认证方式").selectOption("password");
  const secret = "Browser-Temporary-Secret-42";
  await page.locator('input[type="password"]').fill(secret);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const draft = await page.evaluate(() =>
    sessionStorage.getItem("wizard:gpu_vm"),
  );
  expect(draft).not.toContain(secret);
  await page.getByLabel("我已阅读并确认配置与计费方式").check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page).toHaveURL(/resources\/servers\?drawer=/);
  const stored = await page.evaluate(() =>
    localStorage.getItem("rs.mock.database.v2"),
  );
  expect(stored).not.toContain(secret);
});
test("inference governance reviews changes, persists settings and stays read-only for viewers", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
  const r = await page.evaluate(async () => {
    const data = await (
      await fetch("/api/resources?kind=inference&size=1000")
    ).json();
    return data.items.find(
      (r: { status: string }) => r.status === "running",
    ) as { resourceUuid: string; region: string; displayId: string };
  });
  await page.goto(
    `/resources/inference?drawer=${r.resourceUuid}&region=${r.region}`,
  );
  await page.getByRole("tab", { name: "服务治理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "版本与灰度流量", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    "Authorization: Bearer $RUNSUN_API_KEY",
  );
  const before = await page.evaluate(
    async (uuid) =>
      await (await fetch(`/api/resources/${uuid}/governance`)).json(),
    r.resourceUuid,
  );
  let writes = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/governance")) writes++;
  });
  const edit = async () => {
    await page
      .getByRole("button", { name: "编辑治理配置", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "编辑治理配置",
      exact: true,
    });
    await modal.getByLabel("灰度流量比例", { exact: true }).fill("17");
    await modal.getByLabel("QPS 上限", { exact: true }).fill("240");
    await modal.getByLabel("请求超时", { exact: true }).fill("45000");
    await modal
      .getByRole("button", { name: "核对治理变更", exact: true })
      .click();
    return page.getByRole("dialog", { name: "核对治理变更", exact: true });
  };
  const canceled = await edit();
  await expect(canceled).toContainText("→ 17 %");
  expect(writes).toBe(0);
  await canceled.getByRole("button", { name: "取消", exact: true }).click();
  const unchanged = await page.evaluate(
    async (uuid) =>
      await (await fetch(`/api/resources/${uuid}/governance`)).json(),
    r.resourceUuid,
  );
  expect(unchanged.canaryPercent).toBe(before.canaryPercent);
  const review = await edit();
  await review.getByRole("button", { name: "确认", exact: true }).click();
  await expect(review).not.toBeVisible();
  expect(writes).toBe(1);
  await expect(
    page.getByRole("dialog").getByRole("cell", { name: "17%", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "服务治理", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("cell", { name: "83%", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(
    async (uuid) =>
      await (await fetch(`/api/resources/${uuid}/governance`)).json(),
    r.resourceUuid,
  );
  expect(saved).toMatchObject({
    canaryPercent: 17,
    qpsLimit: 240,
    timeoutMs: 45000,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "账号与组织", exact: true }).click();
  await page.getByLabel("切换角色视图").selectOption("viewer");
  await page.keyboard.press("Escape");
  await page.locator("main tbody tr").filter({ hasText: r.displayId }).click();
  await page.getByRole("tab", { name: "服务治理", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑治理配置", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.locator("main tbody tr").filter({ hasText: r.displayId }).click();
  await page
    .getByRole("tab", { name: "Service governance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Versions and traffic", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Events", exact: true }).click();
  await expect(
    page.getByText("Inference gateway policy and canary traffic updated", {
      exact: true,
    }),
  ).toBeVisible();
});

test("overview uses regional allocations and realistic separate memory quotas", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
  await expect(page.locator(".overview-stats .stat")).toHaveCount(4);
  await expect(
    page.getByRole("heading", { name: "区域分布", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".overview-stats")).not.toContainText("运行中资源");
  const matrix = page.locator(".overview-distribution");
  await expect(matrix.locator("tbody tr")).toHaveCount(4);
  await expect(matrix.locator("th").filter({ hasText: "日本" })).toBeVisible();
  await expect(matrix).toContainText("14 台设备");
  await expect(matrix).toContainText("128 GPU");
  await expect(page.getByText("主机内存 GB", { exact: true })).toHaveCount(3);
  await expect(page.getByText("块存储 · TB", { exact: true })).toHaveCount(3);
  await expect(page.getByText("文件存储 · TB", { exact: true })).toHaveCount(3);
  await expect(page.getByText("对象存储 · TB", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "自定义模块", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toContainText("区域分布");
  await page.keyboard.press("Escape");
  await matrix.locator("tbody tr").nth(1).locator("button").first().click();
  await expect(page).toHaveURL(/resources\/baremetal\?region=jp/);
});
test("deployment estimates remain beside the form on laptop and desktop screens", async ({
  page,
}) => {
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/deployment/server");
    await expect(page.locator(".cost-total")).toBeVisible();
    const main = await page.locator(".wizard-main").boundingBox();
    const price = await page.locator(".cost-summary").boundingBox();
    expect(main).toBeTruthy();
    expect(price).toBeTruthy();
    expect(price!.x).toBeGreaterThanOrEqual(main!.x + main!.width);
    expect(Math.abs(price!.y - main!.y)).toBeLessThan(5);
    expect(price!.x + price!.width).toBeLessThanOrEqual(width);
    expect(price!.width).toBeGreaterThanOrEqual(300);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".wizard-main")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("bare metal clusters expose every machine and switch hardware and firmware scope", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
  const r = await page.evaluate(async () => {
    const data = await (
      await fetch("/api/resources?kind=gpu_baremetal&size=1000")
    ).json();
    return data.items.find(
      (r: { status: string }) => r.status === "running",
    ) as {
      resourceUuid: string;
      region: string;
      spec: { machineCount: number };
    };
  });
  await page.goto(
    `/resources/baremetal?drawer=${r.resourceUuid}&region=${r.region}`,
  );
  const inventory = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "集群设备清单", exact: true }),
  });
  await expect(inventory.locator("tbody tr")).toHaveCount(r.spec.machineCount);
  const devices = await page.evaluate(
    async (uuid) =>
      await (await fetch(`/api/resources/${uuid}/machines`)).json(),
    r.resourceUuid,
  );
  await inventory.locator("tbody tr").nth(1).click();
  await expect(page.getByLabel("当前设备", { exact: true })).toHaveValue("1");
  await expect(
    page.getByRole("heading", { name: devices[1].name, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "带外管理" })).toHaveCount(0);
  await page.getByRole("tab", { name: "固件与驱动", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: `${devices[1].name} · 固件与驱动` }),
  ).toBeVisible();
  await page.getByLabel("当前设备", { exact: true }).selectOption("0");
  await expect(
    page.getByRole("heading", { name: `${devices[0].name} · 固件与驱动` }),
  ).toBeVisible();
});

test("restored mock state repairs PVC capacity without discarding saved resources", async ({
  page,
}) => {
  await page.goto("/overview");
  await expectOverviewAllocation(page);
  const project = await page.evaluate(
    async () =>
      await (
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Role": "owner" },
          body: JSON.stringify({
            name: "Retained project",
            slug: "migration-retained",
          }),
        })
      ).json(),
  );
  const original = await page.evaluate(() => {
    const key = "rs.mock.database.v2";
    const data = JSON.parse(localStorage.getItem(key)!);
    const cluster = data.resources.find(
      (r: { kind: string }) => r.kind === "vgpu",
    );
    cluster.name = "retained-migrated-cluster";
    cluster.spec.storageGb = 17;
    localStorage.setItem(key, JSON.stringify(data));
    return {
      id: cluster.resourceUuid,
      pvc: cluster.spec.defaultPvcGb,
      count: data.resources.length,
    };
  });
  await page.reload();
  await expectOverviewAllocation(page);
  const restored = await page.evaluate(
    async (id) => await (await fetch(`/api/resources/${id}`)).json(),
    original.id,
  );
  expect(restored.name).toBe("retained-migrated-cluster");
  expect(restored.spec.storageGb).toBe(original.pvc);
  const count = await page.evaluate(
    async () => (await (await fetch("/api/resources?size=1000")).json()).total,
  );
  expect(count).toBe(original.count);
  const projects = await page.evaluate(
    async () => await (await fetch("/api/projects")).json(),
  );
  expect(projects.some((p: { id: string }) => p.id === project.id)).toBe(true);
});

test("network console manages isolated VPCs and dependent subnets", async ({
  page,
}) => {
  await page.goto("/network/vpcs");
  await expect(
    page.getByRole("heading", { name: "专有网络 VPC", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-vpc");
  await form
    .getByRole("textbox", { name: "IPv4 网段", exact: true })
    .fill("10.110.0.0/16");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "e2e-vpc", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "创建交换机", exact: true }).click();
  const modal = page.getByRole("dialog").last();
  await modal
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-subnet");
  await modal
    .getByRole("textbox", { name: "IPv4 网段", exact: true })
    .fill("10.110.1.0/24");
  await modal.getByRole("button", { name: "确认", exact: true }).click();
  await drawer.getByRole("tab", { name: "交换机", exact: true }).click();
  await expect(drawer).toContainText("e2e-subnet");
  await expect(drawer).toContainText("252");
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("e2e-vpc");
});
test("network console allocates and releases EIPs without a VM", async ({
  page,
}) => {
  await page.goto("/network/eips");
  await page.getByRole("button", { name: "分配公网 IP", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-idle-ip");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "e2e-idle-ip", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("未绑定");
  await drawer
    .getByRole("button", { name: "释放公网 IP", exact: true })
    .click();
  const modal = page.getByRole("dialog").last();
  const text = await modal.locator(".field > span").first().textContent();
  const displayId = text!.match(/eip-[a-f0-9]+/)![0];
  await modal.getByRole("textbox").fill(displayId);
  await modal.getByRole("button", { name: "释放公网 IP", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("包含已释放地址").check();
  await page.getByRole("button", { name: "e2e-idle-ip", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已释放");
});
test("network console creates firewall rules and configures IPsec without exposing a secret", async ({
  page,
}) => {
  await page.goto("/network/firewalls");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  let form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-firewall");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "e2e-firewall", exact: true }).click();
  await page.getByRole("button", { name: "添加规则", exact: true }).click();
  form = page.getByRole("dialog").last();
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("tab", { name: "入方向", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("443–443");
  await page.keyboard.press("Escape");
  await page.goto("/network/eips");
  await page.getByRole("button", { name: "分配公网 IP", exact: true }).click();
  form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-vpn-gateway");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.goto("/network/tunnels");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("e2e-office-tunnel");
  const select = form.getByLabel("弹性公网 IP", { exact: true });
  await expect(select.locator("option")).toHaveCount(2);
  await select.selectOption({ index: 1 });
  await form
    .getByRole("textbox", { name: "对端公网 IP", exact: true })
    .fill("203.0.113.250");
  await form
    .getByLabel("预共享密钥", { exact: true })
    .fill("e2e-top-secret-key-123456");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page
    .getByRole("button", { name: "e2e-office-tunnel", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("配置已停用");
  await expect(page.getByRole("dialog")).toContainText("IKEv2");
  const stored = await page.evaluate(() =>
    localStorage.getItem("rs.mock.database.v2"),
  );
  expect(stored).not.toContain("e2e-top-secret-key-123456");
  await page.screenshot({
    path: "/tmp/runsuncos-network-tunnel.png",
    fullPage: true,
  });
});

test("overview and quota page render the same regional quota records", async ({
  page,
}) => {
  const values = ["360 / 450 TB", "280 / 350 TB", "160 / 200 TB"];
  await page.goto("/overview");
  const overview = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "配额用量", exact: true }),
  });
  const japan = overview
    .locator(".grid-3 > div")
    .filter({ hasText: "日本 JP" });
  for (const value of values) await expect(japan).toContainText(value);
  await page.goto("/ops/quotas?region=jp");
  const quotas = page.locator(".grid-4");
  for (const value of values) await expect(quotas).toContainText(value);
});
test("network allocations update regional quotas and prefill a quota request", async ({
  page,
}) => {
  await page.goto("/ops/quotas?region=jp");
  for (const [kind, value] of [
    ["块存储 · TB", "360 / 450 TB"],
    ["文件存储 · TB", "280 / 350 TB"],
    ["对象存储 · TB", "160 / 200 TB"],
  ]) {
    const card = page.locator(".grid-4 .panel").filter({
      has: page.getByRole("heading", { name: kind, exact: true }),
    });
    await expect(card).toContainText(value);
  }
  const panel = page.locator(".panel").filter({
    has: page.getByRole("heading", { name: "网络资源配额", exact: true }),
  });
  const row = panel.getByRole("row").filter({
    has: page.getByRole("link", { name: "专有网络 VPC 数", exact: true }),
  });
  await expect(row).toBeVisible();
  const before = Number(await row.locator("td").nth(1).textContent());
  await page.goto("/network/vpcs?region=jp");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("quota-linked-vpc");
  await form
    .getByRole("textbox", { name: "IPv4 网段", exact: true })
    .fill("10.120.0.0/16");
  await form.getByRole("button", { name: "确认", exact: true }).click();
  await expect(form).not.toBeVisible();
  await page.goto("/ops/quotas?region=jp");
  await expect(row.locator("td").nth(1)).toHaveText(String(before + 1));
  await expect(
    page.getByRole("heading", { name: "交换机地址用量", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/runsuncos-network-quotas.png",
    fullPage: true,
  });
  await row.getByRole("link", { name: "申请配额", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("textbox").first(),
  ).toHaveValue(/专有网络 VPC 数/);
});
test("resource network tabs show per-device private addresses and deployment choices are scoped", async ({
  page,
}) => {
  for (const route of ["servers", "baremetal", "vgpu", "inference"]) {
    await page.goto(`/resources/${route}`);
    await page.locator("tbody tr").first().click();
    await page.getByRole("tab", { name: "网络与存储", exact: true }).click();
    const panel = page.locator(".panel").filter({
      has: page.getByRole("heading", { name: "网络管理", exact: true }),
    });
    await expect(panel.locator("tbody tr").first()).toBeVisible();
    await expect(panel.locator("tbody")).toContainText(/10\.(16|32|48|64)\./);
    await page.keyboard.press("Escape");
  }
  await page.goto("/deployment/server");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByLabel("VPC", { exact: true })).toHaveValue(/^vpc-/);
  const values = await page
    .getByLabel("安全组", { exact: true })
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
  expect(values.length).toBeGreaterThan(0);
  expect(values.every((v) => v.startsWith("sg-"))).toBe(true);
});
test("resource monitoring loads six charts at a time across all four kinds", async ({
  page,
}) => {
  await page.goto("/resources/servers");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const resources = await page.evaluate(
    async () =>
      (await (await fetch("/api/resources?size=1000")).json()).items as {
        kind: string;
        resourceUuid: string;
        region: string;
        status: string;
      }[],
  );
  for (const [kind, route, tab] of [
    ["gpu_vm", "servers", "监控"],
    ["gpu_baremetal", "baremetal", "硬件监控"],
    ["vgpu", "vgpu", "控制面"],
    ["inference", "inference", "监控"],
  ]) {
    const resource = resources.find(
      (item) => item.kind === kind && item.status === "running",
    )!;
    await page.goto(
      `/resources/${route}?drawer=${resource.resourceUuid}&region=${resource.region}`,
    );
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(
      page.getByRole("dialog").locator(".recharts-wrapper"),
    ).toHaveCount(6);
    if (kind === "gpu_vm" || kind === "inference") {
      const catalog = await page.evaluate(
        async ({ kind, id }) =>
          (await (
            await fetch(`/api/metrics/${kind}/${id}?catalog=true`)
          ).json()) as {
            key: string;
            points: unknown[];
          }[],
        { kind, id: resource.resourceUuid },
      );
      expect(catalog.length).toBeGreaterThan(6);
      expect(catalog.every((series) => series.points.length === 0)).toBe(true);
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      await expect(
        page.getByRole("dialog").locator(".recharts-wrapper"),
      ).toHaveCount(6);
    }
  }
});
test("expanded resource specifications can be filtered in every resource list", async ({
  page,
}) => {
  for (const [route, label] of [
    ["servers", "单实例卡数"],
    ["baremetal", "机型"],
    ["vgpu", "切片策略"],
    ["inference", "模型"],
  ]) {
    await page.goto(`/resources/${route}?region=jp`);
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    expect(before).toBeGreaterThanOrEqual(2);
    const filter = page.getByRole("combobox", { name: label, exact: true });
    const values = await filter
      .locator("option")
      .evaluateAll((options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .filter(Boolean),
      );
    expect(values.length).toBeGreaterThanOrEqual(2);
    await filter.selectOption(values[0]);
    await expect.poll(() => rows.count()).toBeLessThan(before);
    expect(await rows.count()).toBeGreaterThan(0);
  }
});
test("cost analysis belongs to Billing while the old route redirects", async ({
  page,
}) => {
  await page.goto("/billing/cost");
  await expect(page.locator("h1")).toContainText("成本分析");
  await expect(page.locator("aside")).toContainText("项目与支持");
  await page.goto("/ops/cost");
  await expect(page).toHaveURL(/billing\/cost$/);
});

test("deployment storage rows create linked file and object resources", async ({
  page,
}) => {
  await page.goto("/deployment/server");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "添加存储", exact: true }).click();
  const fileRow = page.getByText("存储项 1", { exact: true }).locator("../..");
  await fileRow
    .getByRole("combobox", { name: "类型", exact: true })
    .selectOption("file");
  await fileRow
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("shared-models");
  await page.getByRole("button", { name: "添加存储", exact: true }).click();
  const objectRow = page
    .getByText("存储项 2", { exact: true })
    .locator("../..");
  await objectRow
    .getByRole("combobox", { name: "类型", exact: true })
    .selectOption("object");
  await objectRow
    .getByRole("textbox", { name: "存储桶名称", exact: true })
    .fill("runsun-browser-storage-test");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page
    .getByRole("textbox", { name: "SSH 公钥", exact: true })
    .fill("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFOO");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("我已阅读并确认配置与计费方式").check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page).toHaveURL(/resources\/servers\?drawer=/);
  await page.goto("/storage/file?region=jp");
  await expect(page.locator("tbody")).toContainText("shared-models");
  await page.goto("/storage/object?region=jp");
  await expect(page.locator("tbody")).toContainText(
    "runsun-browser-storage-test",
  );
});

test("model catalog features NVIDIA and Meta and opens deployment for every model", async ({
  page,
}) => {
  await page.goto("/workbench/images");
  await expect(page.locator(".model-catalog-card")).toHaveCount(54);
  await expect(
    page.locator(".model-catalog-card").first().locator("h3"),
  ).toContainText("NVIDIA Nemotron 3 Ultra");
  await expect(
    page.locator(".model-catalog-card").nth(1).locator("h3"),
  ).toContainText("Muse Spark Open");
  await expect(page.locator(".model-catalog-status.ready")).toHaveCount(54);
  await expect(
    page
      .locator(".model-catalog-card")
      .getByRole("button", { name: "基于此项部署" }),
  ).toHaveCount(54);
  await page.getByRole("textbox", { name: "搜索" }).fill("Nemotron-3-Ultra");
  await expect(page.locator(".model-catalog-card")).toHaveCount(1);
  await page
    .locator(".model-catalog-card")
    .getByRole("button", { name: "详情" })
    .click();
  await expect(page.locator(".model-catalog-note")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("openmdw-1.1");
  await expect(page.getByRole("dialog")).toContainText("262,144");
  await expect(page.getByRole("link", { name: /官方模型卡/ })).toHaveAttribute(
    "href",
    "https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "推理服务" })
    .click();
  await expect(page).toHaveURL(/deployment\/inference\?model=catalog-7/);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.locator(".catalog-card.selected")).toContainText(
    "NVIDIA Nemotron 3 Ultra",
  );
});
