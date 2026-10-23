import { QUOTA_METRICS } from "../types/domain";
import { NETWORK_QUOTA_METRICS } from "../types/network";

export const QUOTA_TICKET_METRICS = [
  ...QUOTA_METRICS.filter((metric) => metric !== "storage" && metric !== "ip"),
  "block",
  "file",
  "object",
  ...NETWORK_QUOTA_METRICS,
] as const;

export type QuotaTicketMetric = (typeof QUOTA_TICKET_METRICS)[number];

export function quotaTicketMetric(value: string | null): QuotaTicketMetric {
  const metric = value === "storage" ? "block" : value;
  return QUOTA_TICKET_METRICS.find((item) => item === metric) || "gpu";
}
