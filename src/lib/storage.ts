import type { StorageProduct, StorageRequest, StorageVolume } from "../types/storage";

export const STORAGE_PRODUCTS: readonly StorageProduct[] = [
  {
    kind: "block",
    tier: "essd_pl0",
    minGb: 40,
    maxGb: 32760,
    stepGb: 10,
    usdGbMonth: 0.09,
  },
  {
    kind: "block",
    tier: "essd_pl1",
    minGb: 40,
    maxGb: 32760,
    stepGb: 10,
    usdGbMonth: 0.14,
  },
  {
    kind: "block",
    tier: "essd_pl2",
    minGb: 40,
    maxGb: 32760,
    stepGb: 10,
    usdGbMonth: 0.22,
  },
  {
    kind: "file",
    tier: "nas_capacity",
    minGb: 100,
    maxGb: 1048500,
    stepGb: 100,
    usdGbMonth: 0.15,
  },
  {
    kind: "file",
    tier: "nas_performance",
    minGb: 100,
    maxGb: 1048500,
    stepGb: 100,
    usdGbMonth: 0.3,
  },
  {
    kind: "object",
    tier: "oss_standard",
    minGb: 100,
    maxGb: 1048500,
    stepGb: 100,
    usdGbMonth: 0,
  },
  {
    kind: "object",
    tier: "oss_ia",
    minGb: 100,
    maxGb: 1048500,
    stepGb: 100,
    usdGbMonth: 0,
  },
];

export function storageProduct(kind: string, tier: string) {
  return STORAGE_PRODUCTS.find(
    (product) => product.kind === kind && product.tier === tier,
  );
}

export function storageExtraGb(requests: readonly StorageRequest[] = []) {
  return requests
    .filter((request) => request.kind !== "object")
    .reduce((sum, request) => sum + request.sizeGb * request.count, 0);
}

export function isRegionalPoolVolume(volume: Pick<StorageVolume, "id" | "inventoryScope">) {
  return volume.inventoryScope === "regional_pool" ||
    /^vol-(jp|sg|us)-(block|file)-allocated-\d+$/.test(volume.id);
}
