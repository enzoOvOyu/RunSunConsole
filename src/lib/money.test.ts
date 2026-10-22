import { it, expect } from "vitest";
import { money, round, size } from "./money";
import { useLocale } from "../stores/locale";
it("formats USD and avoids float display errors in both locales", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    useLocale.setState({ locale });
    expect(money(1234.5)).toContain("1,234.50");
  }
  expect(round(0.1 + 0.2)).toBe(0.3);
  expect(size(2048)).toBe("2.05 TB");
});
