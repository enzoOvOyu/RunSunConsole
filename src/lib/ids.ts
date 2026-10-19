import { Monitor, Server, Boxes, Zap } from "lucide-react";
import type { Kind, ResourceUuid, DisplayId } from "../types/domain";
export const KIND_META = {
  gpu_vm: {
    routeKey: "servers",
    deployKey: "server",
    prefix: "srv-",
    icon: Monitor,
    color: "var(--rs-type-server)",
  },
  gpu_baremetal: {
    routeKey: "baremetal",
    deployKey: "baremetal",
    prefix: "bm-",
    icon: Server,
    color: "var(--rs-type-baremetal)",
  },
  vgpu: {
    routeKey: "vgpu",
    deployKey: "vgpu",
    prefix: "vgpu-",
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
export const resourceLink = (r: { kind: Kind; resourceUuid: ResourceUuid }) =>
  `/resources/${KIND_META[r.kind].routeKey}?drawer=${r.resourceUuid}`;
export function displayId(kind: Kind, uuid: string): DisplayId {
  return `${KIND_META[kind].prefix}${uuid.replaceAll("-", "").slice(-6)}` as DisplayId;
}
