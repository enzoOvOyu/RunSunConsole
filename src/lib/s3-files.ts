/** S3 Files can only expose object keys that can be represented as file paths. */
export function filePathIssue(
  key: string,
): "empty" | "component" | "length" | null {
  if (!key || key.includes("\0")) return "empty";
  if (new TextEncoder().encode(key).length > 1024) return "length";
  const parts = key.endsWith("/")
    ? key.slice(0, -1).split("/")
    : key.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        new TextEncoder().encode(part).length > 255,
    )
  )
    return "component";
  return null;
}

export function fileScopePrefix(value: string): string | null {
  const prefix = value.trim().replace(/^\/+/, "");
  if (!prefix) return "";
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return filePathIssue(normalized) ? null : normalized;
}
