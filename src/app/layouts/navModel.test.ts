import { it, expect } from "vitest";
import { buildGroups } from "./navModel";
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
  expect(groups.find((g) => g.id === "workbench")?.items.map((i) => i.id)).toContain(
    "ssh-keys",
  );
  expect(groups.find((g) => g.id === "ops")?.items.map((i) => i.id)).toEqual([
    "projects",
    "quotas",
    "tickets",
  ]);
  expect(
    groups.find((g) => g.id === "billing")?.items.map((i) => i.id),
  ).toEqual(["cost", "bills", "vouchers"]);
  expect(buildGroups("member").find((g) => g.id === "billing")).toBeUndefined();
  expect(
    buildGroups("billing").find((g) => g.id === "billing")?.items[0].path,
  ).toBe("/billing/cost");
  expect(dictionaries["zh-CN"]["nav.ops"]).toBe("项目与支持");
  expect(dictionaries["en-US"]["nav.ops"]).toBe("Projects & Support");
  expect(dictionaries["zh-CN"]["nav.resources"]).toBe("我的资源");
  expect(dictionaries["en-US"]["nav.resources"]).toBe("My resources");
});
