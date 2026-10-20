import { it, expect } from "vitest";
import { buildGroups } from "./navModel";
import { dictionaries } from "../../i18n";
it("assigns distinct semantic submenu icons through the shared navigation model", () => {
  const groups = buildGroups("owner");
  for (const id of ["ops", "workbench", "data", "billing"]) {
    const group = groups.find((g) => g.id === id)!;
    expect(new Set(group.items.map((i) => i.icon)).size).toBe(
      group.items.length,
    );
    expect(group.items.every((i) => i.icon && i.icon !== group.icon)).toBe(
      true,
    );
  }
  expect(dictionaries["zh-CN"]["nav.resources"]).toBe("我的资源");
  expect(dictionaries["en-US"]["nav.resources"]).toBe("My resources");
});
