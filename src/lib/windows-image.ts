import type { Image } from "../types/domain";

export const WINDOWS_RDP_PORT = 3389;
export const WINDOWS_MIN_SYSTEM_DISK_GB = 100;
export const WINDOWS_LOGIN_USER = "Administrator";

export function isWindowsImage(image: Image | undefined): boolean {
  return image?.type === "os" && image.osFamily === "Windows Server";
}

export function validWindowsPassword(value: string): boolean {
  return value.length >= 12 && value.length <= 128 &&
    [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3;
}
