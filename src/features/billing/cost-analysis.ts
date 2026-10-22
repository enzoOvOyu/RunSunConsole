import type { Usage } from "../../types/domain";
import { round } from "../../lib/money";

type CostDimension = "project" | "resource" | "region" | "kind";

export function allocateCents(amounts: number[], targetCents: number) {
  const cents = amounts.map((amount) => Math.floor(amount * 100));
  const fractions = amounts.map((amount, index) => ({
    index,
    remainder: amount * 100 - cents[index],
  }));
  let remaining = targetCents - cents.reduce((sum, value) => sum + value, 0);
  fractions.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of fractions) {
    if (remaining <= 0) break;
    cents[index]++;
    remaining--;
  }
  return cents.map((value) => value / 100);
}

export function analyzeCostUsage(
  usage: Usage[],
  billingPeriod: string,
  dimension: CostDimension,
) {
  const [year, month] = billingPeriod.split("-").map(Number);
  const days =
    year && month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  const dates = Array.from({ length: days }, (_, index) =>
    new Date(Date.UTC(year, month - 1, index + 1)).toISOString().slice(0, 10),
  );
  const daily = new Map<string, number>();
  const groups = new Map<
    string,
    { rows: Usage[]; amount: number; resourceIds: Set<string> }
  >();
  const resourceIds = new Set<string>();
  let total = 0;
  for (const row of usage) {
    if (!row.usageHour.startsWith(billingPeriod)) continue;
    total += row.amount;
    const day = row.usageHour.slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + row.amount);
    if (row.resourceUuid) resourceIds.add(row.resourceUuid);
    const key =
      dimension === "project"
        ? row.projectId
        : dimension === "resource"
          ? row.displayId
          : dimension === "region"
            ? row.region
            : row.kind;
    let group = groups.get(key);
    if (!group) {
      group = { rows: [], amount: 0, resourceIds: new Set<string>() };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.amount += row.amount;
    if (row.resourceUuid) group.resourceIds.add(row.resourceUuid);
  }
  const totalCents = Math.round((total + Number.EPSILON) * 100);
  const entries = [...groups].map(([key, group]) => ({ key, ...group }));
  const groupAmounts = allocateCents(
    entries.map((group) => group.amount),
    totalCents,
  );
  const dailyAmounts = allocateCents(
    dates.map((date) => daily.get(date) || 0),
    totalCents,
  );
  const trend = dates.map((date, index) => ({
    date,
    amount: dailyAmounts[index],
  }));
  const today =
    trend.find((point) => point.date === new Date().toISOString().slice(0, 10))
      ?.amount || 0;
  return {
    month: totalCents / 100,
    today,
    trend,
    resourceCount: resourceIds.size,
    groups: entries.map((group, index) => ({
      key: group.key,
      rows: group.rows,
      amount: groupAmounts[index],
      resourceCount: group.resourceIds.size,
    })),
  };
}

export function aggregateUsage(rows: Usage[], totalAmount?: number) {
  const map = new Map<string, Usage>();
  for (const row of rows) {
    const key = `${row.resourceUuid}-${row.unit}-${row.unitPrice}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += row.amount;
      existing.quantity += row.quantity;
    } else map.set(key, { ...row });
  }
  const result = [...map.values()];
  const cents = Math.round(
    ((totalAmount ?? round(rows.reduce((sum, row) => sum + row.amount, 0))) +
      Number.EPSILON) *
      100,
  );
  const amounts = allocateCents(
    result.map((row) => row.amount),
    cents,
  );
  return result.map((row, index) => ({ ...row, amount: amounts[index] }));
}
