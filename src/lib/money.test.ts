import { it, expect } from "vitest";
import { money, round, size, sizeBytes } from "./money";
import { useLocale } from "../stores/locale";
it("formats USD and avoids float display errors in both locales", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    useLocale.setState({ locale });
    expect(money(1234.5)).toContain("1,234.50");
  }
  expect(round(0.1 + 0.2)).toBe(0.3);
  expect(size(2048)).toBe("2.05 TB");
});

it("steps object sizes from bytes through TB", () => {
  expect(sizeBytes(512)).toBe("512 B");
  expect(sizeBytes(2048)).toBe("2.05 KB");
  expect(sizeBytes(3_000_000)).toBe("3 MB");
  expect(sizeBytes(8_000_000_000)).toBe("8 GB");
  expect(sizeBytes(2_000_000_000_000)).toBe("2 TB");
});
