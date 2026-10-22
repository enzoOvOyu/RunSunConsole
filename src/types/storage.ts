import type { Region, ResourceUuid } from "./domain";

export type StorageKind = "block" | "file" | "object";

export interface StorageProduct {
  kind: StorageKind;
  tier: string;
  minGb: number;
  maxGb: number;
  stepGb: number;
  usdGbMonth: number;
}

export interface StorageRequest {
  key: string;
  kind: StorageKind;
  tier: string;
  name: string;
  sizeGb: number;
  count: number;
  mountPath: string;
}

export interface StorageVolume {
  id: string;
  name: string;
  kind: "block" | "file";
  tier: string;
  role: "system" | "data" | "pvc" | "cache" | "custom";
  sizeGb: number;
  projectId: string;
  region: Region;
  zone?: string;
  resourceUuid: ResourceUuid | null;
  mountPath: string;
  createdAt: string;
  deletedAt: string | null;
}
