import type { Role } from "../types/domain";
export const canWrite = (role: Role) =>
  ["owner", "admin", "member"].includes(role);
export const canManageOrg = (role: Role) =>
  role === "owner" || role === "admin";
export const isResourceReadOnly = (role: Role) => !canWrite(role);
export function canSeePath(role: Role, path: string) {
  if (role === "billing")
    return (
      path.startsWith("/resources/") ||
      path.startsWith("/billing/") ||
      path === "/network/eips" ||
      path === "/overview"
    );
  if (role === "member") return !path.startsWith("/billing/");
  return true;
}
