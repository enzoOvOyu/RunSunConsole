import type { ResourceOf } from "../types/domain";

export function inferenceEndpoint(
  resource: Pick<ResourceOf<"inference">, "displayId" | "region">,
) {
  return `https://${resource.displayId}.${resource.region}.runsun.cloud`;
}
