import { expect, test } from "@playwright/test";

test("GPU VM server command line, safe commands, fullscreen and lifecycle", async ({
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
  test.skip(!vm, "No available GPU VM");
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
  await expect(page.locator(".terminal-screen-header")).toContainText(
    vm!.displayId,
  );
  await expect(page.getByText(/模拟|Mock/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Home", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Web Browser", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /连接|Connect/, exact: true }).click();
  await expect(
    page.getByText(/已连接|Connected/, { exact: true }),
  ).toBeVisible();
  const terminal = page.getByRole("textbox", {
    name: /服务器命令输入|Server command input/,
  });
  await terminal.fill("help");
  await terminal.press("Enter");
  await expect(page.locator(".terminal-output")).toContainText(
    "Available commands:",
  );
  await terminal.fill("nvidia-smi");
  await terminal.press("Enter");
  await expect(page.locator(".terminal-output")).toContainText("GPU count:");
  await terminal.fill("rm -rf /");
  await terminal.press("Enter");
  await expect(page.locator(".terminal-output")).toContainText(
    "command not found",
  );

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
    .locator(".terminal-toolbar-actions")
    .getByRole("button", { name: /停止|Stop/, exact: true })
    .click();
  await expect(
    page.locator(".terminal-state-instance-stopped").first(),
  ).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: /连接|Connect/, exact: true }),
  ).toBeDisabled();
});
