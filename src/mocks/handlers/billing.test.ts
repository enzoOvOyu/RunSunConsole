import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./index";
import { db, makeDatabase } from "../lib/database";
import { invoicePeriodForSelection } from "../../lib/billing-period";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  Object.assign(db, makeDatabase());
  db.resources = [];
  db.network.eips = [];
  db.usage = [];
  db.vouchers = [];
});
async function report(period: string) {
  const response = await fetch(
    `http://localhost/api/billing/report?billing_period=${period}`,
  );
  expect(response.status).toBe(200);
  return response.json();
}

it("shows only a fixed closed-month invoice and keeps bill totals on the selected period", async () => {
  const current = new Date().toISOString().slice(0, 7);
  const previous = invoicePeriodForSelection(current)!;
  const seed = makeDatabase().usage[0];
  db.usage.push({
    ...seed,
    id: "prior-charge",
    usageHour: `${previous}-15T00:00:00.000Z`,
    amount: 100.25,
  });
  db.usage.push({
    ...seed,
    id: "current-charge",
    usageHour: `${current}-15T00:00:00.000Z`,
    amount: 20,
  });
  const voucher = makeDatabase().vouchers[0];
  db.vouchers = [
    {
      ...voucher,
      redemptions: [
        {
          at: `${previous}-16T00:00:00.000Z`,
          amount: 10,
          referenceId: `invoice-${previous}`,
        },
      ],
    },
  ];
  const currentBill = await report(current);
  expect(currentBill.grossAmount).toBe(20);
  expect(currentBill.payable).toBe(20);
  expect(currentBill.invoices).toMatchObject([
    { period: previous, grossAmount: 100.25, voucherUsed: 10, amount: 90.25 },
  ]);
  const historicalBill = await report(previous);
  expect(historicalBill.payable).toBe(historicalBill.invoices[0].amount);
  expect(historicalBill.grossAmount).toBe(100.25);
  db.usage[0].amount = 500;
  expect((await report(current)).invoices[0].amount).toBe(90.25);
  expect(db.invoices).toHaveLength(1);
});

it("does not invent an invoice when the previous month has no usage", async () => {
  const current = new Date().toISOString().slice(0, 7);
  const bill = await report(current);
  expect(bill.invoices).toEqual([]);
  expect(db.invoices).toEqual([]);
});

it("maps January to the previous December and rejects future invoice periods", () => {
  expect(invoicePeriodForSelection("2026-01", "2026-01")).toBe("2025-12");
  expect(invoicePeriodForSelection("2025-12", "2026-01")).toBe("2025-12");
  expect(invoicePeriodForSelection("2026-02", "2026-01")).toBeNull();
});

it("hides charges displayed as zero while preserving bill totals and resource references", async () => {
  const current = new Date().toISOString().slice(0, 7);
  const at = `${current}-15T00:00:00.000Z`;
  const seed = makeDatabase().transactions[0];
  db.transactions = [
    { ...seed, id: "subcent", at, type: "charge", amount: -0.0001, resourceUuid: "resource-a" as typeof seed.resourceUuid },
    { ...seed, id: "cent", at, type: "charge", amount: -0.01, resourceUuid: "resource-a" as typeof seed.resourceUuid },
  ];
  const bill = await report(current);
  expect(bill.transactions.map((transaction: { id: string }) => transaction.id)).toEqual(["cent"]);
  expect(bill.transactions[0].resourceUuid).toBe("resource-a");
  const response = await fetch(`http://localhost/api/billing/transactions?billing_period=${current}`);
  expect((await response.json()).map((transaction: { id: string }) => transaction.id)).toEqual(["cent"]);
});
