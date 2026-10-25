import { expect, test } from "@playwright/test";

test("GPU VM server command line, safe commands, fullscreen and lifecycle", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.removeItem("rs.mock.database.v2"),
  );
  await page.goto("/resources/servers?region=jp");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const row = page
    .locator("tbody tr")
    .filter({ hasText: /运行中|Running/ })
    .first();
  test.skip(!(await row.count()), "No running GPU VM in the current region");
  const displayId = (await row.locator(".resource-id").textContent())?.trim();
  if (!displayId) throw new Error("GPU VM row has no resource ID");
  await row.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const resourceUuid = new URL(page.url()).searchParams.get("drawer");
  if (!resourceUuid) throw new Error("Resource drawer has no resource ID");
  await page.getByRole("button", { name: /重置密码|Reset password/ }).click();
  const passwordDialog = page.getByRole("dialog").last();
  const password = (await passwordDialog.locator("pre").textContent())?.trim();
  if (!password) throw new Error("Password reset did not return a credential");
  await page.keyboard.press("Escape");
  await page.evaluate(async (uuid) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const resource = await (await fetch(`/api/resources/${uuid}`)).json();
      if (resource.spec.authMethod === "password") return;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  }, resourceUuid);
  await page.getByRole("tab", { name: /控制台|Console/, exact: true }).click();

  await expect(page.locator(".terminal-screen-header")).toContainText(
    displayId,
  );
  await expect(page.getByText(/模拟|Mock/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Home", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Web Browser", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /连接|Connect/, exact: true }).click();
  await expect(page.locator(".terminal-login")).toBeVisible();
  await page.getByRole("textbox", { name: "密码" }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.locator(".terminal-state-connected"),
  ).toBeVisible();
  const terminal = page.getByRole("textbox", {
    name: /服务器命令输入|Server command input/,
  });
  await expect(page.locator(".terminal-input-row span")).toContainText("root@");
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
