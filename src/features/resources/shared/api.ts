import { api, EP } from "../../../lib/api-client";
import type { Resource } from "../../../types/domain";
export async function fetchHistoricalResource(uuid: string) {
  try {
    return await api<Resource>(`${EP.resources}/${uuid}`);
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      error.status === 410 &&
      "details" in error
    )
      return (error.details as { resource: Resource }).resource;
    throw error;
  }
}
