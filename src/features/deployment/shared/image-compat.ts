import type { Image, Pool } from "../../../types/domain";

const LINUX_FAMILIES = ["Ubuntu", "Rocky Linux", "Debian"];

export function imageOsFamily(image: Image) {
  if (image.osFamily) return image.osFamily;
  const identity = `${image.id} ${image.name}`.toLowerCase();
  if (identity.includes("windows")) return "Windows Server";
  if (identity.includes("rocky")) return "Rocky Linux";
  if (identity.includes("debian")) return "Debian";
  if (identity.includes("ubuntu")) return "Ubuntu";
  return image.type === "container" ? "Linux container" : "Linux";
}

export function imageArchitectures(image: Image): string[] {
  if (Array.isArray(image.architectures)) return image.architectures;
  const family = imageOsFamily(image);
  return family === "Rocky Linux" || family === "Windows Server"
    ? ["x86_64"]
    : ["x86_64", "aarch64"];
}

export function imageSupportsPool(image: Image, pool: Pool["code"]) {
  return Array.isArray(image.supportedGpuModels)
    ? image.supportedGpuModels.includes(pool)
    : true;
}

export function imageSupportsArchitecture(image: Image, architecture: string) {
  return imageArchitectures(image).includes(architecture);
}

export function imageCompatibleWithOs(image: Image, osFamily: string) {
  if (Array.isArray(image.compatibleOsFamilies))
    return image.compatibleOsFamilies.includes(osFamily);
  return image.type === "container" && LINUX_FAMILIES.includes(osFamily);
}

export function imageFrameworks(image: Image) {
  if (Array.isArray(image.frameworks)) return image.frameworks;
  return image.framework ? [image.framework] : [];
}
