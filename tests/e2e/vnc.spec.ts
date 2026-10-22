import { expect, test } from "@playwright/test";

test("GPU VM mock VNC desktop, safe terminal, windows and lifecycle", async ({
  page,
}) => {
  await page.goto("/resources/servers");
  const response = await page.request.get("/api/resources?kind=gpu_vm");
  const payload = (await response.json()) as {
    items: Array<{ displayId: string; status: string }>;
  };
  const vm =
    payload.items.find((item) => item.status === "running") ??
    payload.items.find((item) => item.status === "stopped");
  test.skip(
    !vm,
    "No running or stopped GPU VM is available in the mock catalog",
  );
  const row = page.locator("tbody tr").filter({ hasText: vm!.displayId });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const startButton = page
    .getByRole("button", { name: /启动|Start/, exact: true })
    .first();
  if (await startButton.isEnabled()) {
    await startButton.click();
    await expect(
      page.getByRole("button", { name: /连接|Connect/, exact: true }),
    ).toBeEnabled({ timeout: 10000 });
  }
  await page.getByRole("tab", { name: /控制台|Console/, exact: true }).click();
  await page.getByRole("button", { name: /连接|Connect/, exact: true }).click();
  await expect(
    page.getByText(/已连接|Connected/, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const terminal = page.getByRole("textbox", {
    name: /模拟终端命令输入|Mock terminal command input/,
  });
  await terminal.fill("help");
  await terminal.press("Enter");
  await expect(page.getByText("Available commands:")).toBeVisible();
  await terminal.fill("nvidia-smi");
  await terminal.press("Enter");
  await expect(page.locator(".vnc-terminal-output")).toContainText(
    "GPU count:",
  );

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".vnc-window-files")).toBeVisible();
  await page.getByRole("button", { name: "Web Browser", exact: true }).click();
  await expect(page.locator(".vnc-window-browser")).toBeVisible();

  const titlebar = page.locator(".vnc-window-files .vnc-window-title");
  const before = await titlebar.boundingBox();
  if (!before) throw new Error("Files titlebar is not visible");
  await page.mouse.move(before.x + 40, before.y + 15);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + 60);
  await page.mouse.up();
  const after = await titlebar.boundingBox();
  expect(after?.x).toBeGreaterThan(before.x);

  await page
    .getByRole("button", { name: /全屏|Fullscreen/, exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.getByRole("button", { name: /退出全屏|Exit fullscreen/ }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);

  await page
    .locator(".vnc-toolbar-actions")
    .getByRole("button", { name: /停止|Stop/, exact: true })
    .click();
  await expect(page.locator(".vnc-state-instance-stopped")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: /连接|Connect/, exact: true }),
  ).toBeDisabled();
});
