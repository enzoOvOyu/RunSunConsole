import type { Image } from "../types/domain";

export const WINDOWS_RDP_PORT = 3389;
export const WINDOWS_MIN_SYSTEM_DISK_GB = 100;
export const WINDOWS_LOGIN_USER = "Administrator";

export function isWindowsImage(image: Image | undefined): boolean {
  return image?.type === "os" && image.osFamily === "Windows Server";
}
