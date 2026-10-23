import { describe, expect, it } from "vitest";
import { QUOTA_METRICS } from "../types/domain";
import { NETWORK_QUOTA_METRICS } from "../types/network";
import { QUOTA_TICKET_METRICS, quotaTicketMetric } from "./quota-ticket";

describe("quota ticket metric selection", () => {
  it("offers the platform's compute, storage and network quota types", () => {
    expect(QUOTA_TICKET_METRICS).toEqual([
      ...QUOTA_METRICS.filter((metric) => metric !== "storage" && metric !== "ip"),
      "block", "file", "object",
      ...NETWORK_QUOTA_METRICS,
    ]);
    expect(new Set(QUOTA_TICKET_METRICS).size).toBe(QUOTA_TICKET_METRICS.length);
  });

  it("keeps linked quota selections and handles legacy storage links", () => {
    for (const metric of QUOTA_TICKET_METRICS)
      expect(quotaTicketMetric(metric)).toBe(metric);
    expect(quotaTicketMetric("storage")).toBe("block");
    expect(quotaTicketMetric("unknown")).toBe("gpu");
  });
});
