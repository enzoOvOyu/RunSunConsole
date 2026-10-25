import { useQuery } from "@tanstack/react-query";
import { api, EP } from "../../lib/api-client";
import { setStorageProducts } from "../../lib/storage";
import type { StorageProduct } from "../../types/storage";

export function useStorageProducts() {
  return useQuery({
    queryKey: ["storage-products"],
    queryFn: async ({ signal }) => {
      const products = await api<StorageProduct[]>(EP.storageProducts, { signal });
      // Shared form schemas validate against the same catalog shown by the UI.
      setStorageProducts(products);
      return products;
    },
  });
}
