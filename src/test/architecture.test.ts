import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory()
      ? files(join(dir, f.name))
      : /\.tsx?$/.test(f.name)
        ? [join(dir, f.name)]
        : [],
  );
}
it("keeps mock internals outside UI, user text translated, and source free from suppressions", () => {
  for (const path of files("src").filter((p) => !p.endsWith(".test.ts"))) {
    const s = readFileSync(path, "utf8");
    expect(s, path).not.toMatch(
      /\b(?:TO\x44O|FIX\x4dE|X\x58X)\b|@ts-(?:ignore|expect-error)|eslint-disable/,
    );
    if (/src\/(features|components|app)\//.test(path)) {
      expect(s, path).not.toMatch(
        /from\s+['"][^'"]*mocks\/(fixtures|lib\/derive)/,
      );
      expect(s, path).not.toMatch(/>[\s]*[\u4e00-\u9fff]+[\s]*</);
    }
    if (!path.includes("/mocks/"))
      expect(s, path).not.toMatch(/Math\.random\(/);
  }
});
