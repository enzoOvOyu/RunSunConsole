import { expect, it } from "vitest";
import type { Usage, ResourceUuid, DisplayId } from "../../types/domain";
import { aggregateUsage, analyzeCostUsage } from "./cost-analysis";

const usage: Usage[] = [
  {
    id: "u1",
    resourceUuid: "r1" as ResourceUuid,
    displayId: "GPU-1" as DisplayId,
    projectId: "default",
    region: "jp",
    kind: "gpu_vm",
    usageHour: "2026-10-01T00:00:00.000Z",
    unit: "per_gpu_hour",
    quantity: 1,
    unitPrice: 10.0049,
    amount: 10.0049,
    status: "running",
  },
  {
    id: "u2",
    resourceUuid: "r1" as ResourceUuid,
    displayId: "GPU-1" as DisplayId,
    projectId: "default",
    region: "jp",
    kind: "gpu_vm",
    usageHour: "2026-10-02T00:00:00.000Z",
    unit: "per_gpu_hour",
    quantity: 1,
    unitPrice: 10.0049,
    amount: 0.0049,
    status: "running",
  },
  {
    id: "u3",
    resourceUuid: "r2" as ResourceUuid,
    displayId: "EIP-2" as DisplayId,
    projectId: "production",
    region: "jp",
    kind: "eip",
    usageHour: "2026-10-02T00:00:00.000Z",
    unit: "per_ip_hour",
    quantity: 1,
    unitPrice: 0.0049,
    amount: 0.0049,
    status: "running",
  },
  {
    id: "u4",
    resourceUuid: "r3" as ResourceUuid,
    displayId: "GPU-3" as DisplayId,
    projectId: "training",
    region: "sg",
    kind: "gpu_vm",
    usageHour: "2026-10-02T00:00:00.000Z",
    unit: "per_gpu_hour",
    quantity: 1,
    unitPrice: 5.0049,
    amount: 5.0049,
    status: "running",
  },
  {
    id: "old",
    resourceUuid: "r4" as ResourceUuid,
    displayId: "GPU-4" as DisplayId,
    projectId: "default",
    region: "jp",
    kind: "gpu_vm",
    usageHour: "2026-09-30T00:00:00.000Z",
    unit: "per_gpu_hour",
    quantity: 1,
    unitPrice: 100,
    amount: 100,
    status: "running",
  },
];

it("reconciles every cost dimension and its drilldown to one billing snapshot", () => {
  for (const dimension of ["project", "resource", "region", "kind"] as const) {
    const result = analyzeCostUsage(usage, "2026-10", dimension);
    expect(result.month).toBe(15.02);
    expect(result.resourceCount).toBe(3);
    expect(
      Math.round(
        result.groups.reduce((sum, group) => sum + group.amount, 0) * 100,
      ),
    ).toBe(1502);
    expect(
      Math.round(result.trend.reduce((sum, day) => sum + day.amount, 0) * 100),
    ).toBe(1502);
    for (const group of result.groups) {
      expect(
        group.rows.every((row) => row.usageHour.startsWith("2026-10")),
      ).toBe(true);
      expect(
        Math.round(
          aggregateUsage(group.rows, group.amount).reduce(
            (sum, row) => sum + row.amount,
            0,
          ) * 100,
        ),
      ).toBe(Math.round(group.amount * 100));
    }
  }
});
