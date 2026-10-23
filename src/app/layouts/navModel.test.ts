import { it, expect } from "vitest";
import { buildGroups } from "./navModel";
import { canSeeNavPath, canSeePath } from "../../lib/rbac";
import { dictionaries } from "../../i18n";
it("assigns distinct semantic submenu icons through the shared navigation model", () => {
  const groups = buildGroups("owner");
  for (const id of ["ops", "workbench", "storage", "billing"]) {
    const group = groups.find((g) => g.id === id)!;
    expect(new Set(group.items.map((i) => i.icon)).size).toBe(
      group.items.length,
    );
    expect(group.items.every((i) => i.icon && i.icon !== group.icon)).toBe(
      true,
    );
  }
  expect(
    groups.find((g) => g.id === "workbench")?.items.map((i) => i.id),
  ).toContain("ssh-keys");
  expect(groups.find((g) => g.id === "ops")?.items.map((i) => i.id)).toEqual([
    "projects",
    "quotas",
    "tickets",
    "operation-logs",
  ]);
  expect(
    groups.find((g) => g.id === "billing")?.items.map((i) => i.id),
  ).toEqual(["cost", "bills", "vouchers"]);
  expect(buildGroups("member").find((g) => g.id === "billing")).toBeUndefined();
  expect(
    buildGroups("billing").find((g) => g.id === "billing")?.items[0].path,
  ).toBe("/billing/cost");
  expect(dictionaries["zh-CN"]["nav.ssh-keys"]).toBe("SSH 公钥管理");
  expect(dictionaries["en-US"]["nav.ssh-keys"]).toBe("SSH key management");
  expect(dictionaries["zh-CN"]["nav.ops"]).toBe("项目与支持");
  expect(dictionaries["en-US"]["nav.ops"]).toBe("Projects & Support");
  expect(dictionaries["zh-CN"]["nav.resources"]).toBe("我的资源");
  expect(dictionaries["en-US"]["nav.resources"]).toBe("My resources");
});

it("shows role-appropriate menus while keeping read-only deep links available", () => {
  const ids = (role: Parameters<typeof buildGroups>[0]) =>
    buildGroups(role).map((group) => group.id);
  expect(ids("billing")).toEqual(["overview", "resources", "billing"]);
  expect(ids("viewer")).not.toContain("deployment");
  expect(ids("viewer")).toContain("network");
  expect(ids("member")).not.toContain("billing");
  expect(ids("owner")).toContain("deployment");
  expect(canSeeNavPath("billing", "/network/eips")).toBe(false);
  expect(canSeePath("billing", "/network/eips")).toBe(true);
  expect(canSeeNavPath("viewer", "/deployment/server")).toBe(false);
  expect(canSeePath("viewer", "/deployment/server")).toBe(true);
});
