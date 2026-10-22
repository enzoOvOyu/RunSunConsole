import { Monitor, Server, Boxes, Zap } from "lucide-react";
import type { Kind, ResourceUuid, DisplayId } from "../types/domain";
export const KIND_META = {
  gpu_vm: {
    routeKey: "servers",
    deployKey: "server",
    prefix: "gvm-",
    icon: Monitor,
    color: "var(--rs-type-server)",
  },
  gpu_baremetal: {
    routeKey: "baremetal",
    deployKey: "baremetal",
    prefix: "gbm-",
    icon: Server,
    color: "var(--rs-type-baremetal)",
  },
  vgpu: {
    routeKey: "vgpu",
    deployKey: "vgpu",
    prefix: "kcl-",
    icon: Boxes,
    color: "var(--rs-type-vgpu)",
  },
  inference: {
    routeKey: "inference",
    deployKey: "inference",
    prefix: "inf-",
    icon: Zap,
    color: "var(--rs-type-inference)",
  },
} as const;
export const resourceLink = (r: {
  kind: Kind;
  resourceUuid: ResourceUuid;
  region?: string;
}) =>
  `/resources/${KIND_META[r.kind].routeKey}?drawer=${r.resourceUuid}${r.region ? "&region=" + r.region : ""}`;
export type ResourceIdType =
  | "gvm"
  | "gbm"
  | "kcl"
  | "inf"
  | "vpc"
  | "eip"
  | "sgr"
  | "sub"
  | "eni"
  | "tun"
  | "blk"
  | "fil"
  | "obj";

function resourceIdBody(source: string): string {
  const compact = source.replaceAll("-", "").toLowerCase();
  if (/^[a-f0-9]{16,}$/.test(compact)) return compact.slice(0, 16);

  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  const firstPart = (first >>> 0).toString(16).padStart(8, "0");
  const secondPart = (second >>> 0).toString(16).padStart(8, "0");
  return `${firstPart}${secondPart}`;
}

export function formatResourceId(
  type: ResourceIdType,
  source: string,
  options: { baremetalVpc?: boolean } = {},
): DisplayId {
  const prefix = options.baremetalVpc && type === "vpc" ? `bm${type}` : type;
  return `${prefix}-${resourceIdBody(source)}` as DisplayId;
}

export function displayId(kind: Kind, uuid: string): DisplayId {
  const typeByKind: Record<Kind, ResourceIdType> = {
    gpu_vm: "gvm",
    gpu_baremetal: "gbm",
    vgpu: "kcl",
    inference: "inf",
  };
  return formatResourceId(typeByKind[kind], uuid);
}
