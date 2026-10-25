import { useQuery } from "@tanstack/react-query";
import { api, EP } from "../../lib/api-client";
import type { Resource, PriceEstimate } from "../../types/domain";

export function useDeploymentEstimate(input: Pick<Resource, "kind" | "region" | "nodePool" | "mode" | "spec">) {
  const { kind, region, nodePool, mode, spec } = input;
  return useQuery({
    queryKey: ["estimate", kind, region, nodePool, mode, JSON.stringify(spec)],
    queryFn: ({ signal }) => api<PriceEstimate>(EP.orders + "/estimate", {
      method: "POST", body: JSON.stringify(input), signal,
    }),
    retry: false,
    enabled: !(kind === "vgpu" && "nodePools" in spec && spec.deploymentMode === "slice" && !spec.slice?.skuId),
  });
}
