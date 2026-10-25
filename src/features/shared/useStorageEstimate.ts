import { useQuery } from "@tanstack/react-query";
import { api, EP } from "../../lib/api-client";
import type { PriceEstimate } from "../../types/domain";
import type { StorageRequest } from "../../types/storage";

export function useStorageEstimate(
  rows: Pick<StorageRequest, "key" | "kind" | "tier" | "sizeGb" | "count">[],
  enabled = true,
) {
  const selections = rows.map(({ key, kind, tier, sizeGb, count }) => ({ key, kind, tier, sizeGb, count }));
  return useQuery({
    queryKey: ["storage-estimate", selections],
    queryFn: ({ signal }) => api<(PriceEstimate & { key: string })[]>(EP.storageEstimate, {
      method: "POST", body: JSON.stringify({ selections }), signal,
    }),
    enabled: enabled && selections.length > 0 && selections.every((row) => row.sizeGb > 0 && row.count > 0),
    retry: false,
  });
}
