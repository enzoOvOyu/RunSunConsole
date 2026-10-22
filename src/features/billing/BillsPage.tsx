import { useUrlState } from "../shared/useUrlState";
import type { Usage, Transaction, Invoice } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { invoicePeriodForSelection } from "../../lib/billing-period";
import { useData } from "../shared/hooks";
import { t } from "../../i18n";
import { date } from "../../lib/date";
import { money } from "../../lib/money";
import {
  PageHeader,
  Panel,
  Button,
  DataTable,
  Badge,
  download,
  Loading,
  ErrorState,
} from "../../components/ui";
import { TransactionTable } from "../resources/shared/common";
import { BillingUsageTable } from "./BillingTables";

type BillingReport = {
  usage: Usage[];
  transactions: Transaction[];
  invoices: Invoice[];
  grossAmount: number;
  voucherUsed: number;
  payable: number;
  balance: number;
};

export default function BillsPage() {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useUrlState("billing_period", currentPeriod);
  const report = useData<BillingReport>(
    ["billing-report", period],
    EP.report + query({ billing_period: period }),
  );
  const invoicePeriod = invoicePeriodForSelection(period);
  return (
    <>
      <PageHeader
        title={t("nav.bills")}
        subtitle={t("pageDescription.bills")}
      />
      <div className="toolbar">
        <label className="row">
          {t("billing.period")}
          <input
            className="input"
            type="month"
            max={currentPeriod}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <small>{t("common.allRegions")} · USD</small>
      </div>
      {report.isPending ? (
        <Loading />
      ) : report.error ? (
        <ErrorState error={report.error} />
      ) : (
        <>
          <div className="grid grid-3">
            {[
              {
                label: t("billing.payable"),
                value: report.data.payable,
                isBalance: false,
              },
              {
                label: t("billing.voucherUsed"),
                value: report.data.voucherUsed,
                isBalance: false,
              },
              {
                label: t("common.balance"),
                value: report.data.balance,
                isBalance: true,
              },
            ].map(({ label, value, isBalance }) => (
              <div className="panel stat" key={label}>
                <small>{label}</small>
                <div className="stat-value">{money(Number(value))}</div>
                <small>
                  {isBalance
                    ? t("billing.balanceScope")
                    : t(
                        period === currentPeriod
                          ? "billing.currentPeriodScope"
                          : "billing.closedPeriodScope",
                        { period },
                      )}
                </small>
              </div>
            ))}
          </div>
          <div className="stack section-gap">
            <BillingUsageTable
              usage={report.data.usage}
              billingPeriod={period}
              totalAmount={report.data.grossAmount}
            />
            <Panel title={t("common.transactions")}>
              <TransactionTable rows={report.data.transactions} />
            </Panel>
            <Panel title={t("billing.invoices")}>
              <small>
                {t(
                  period === currentPeriod
                    ? "billing.invoiceScopeCurrent"
                    : "billing.invoiceScopeHistorical",
                  { period: invoicePeriod || "—" },
                )}
              </small>
              {report.data.invoices.length ? (
                <DataTable
                  data={report.data.invoices}
                  columns={[
                    { accessorKey: "id", header: "ID" },
                    { accessorKey: "period", header: t("billing.period") },
                    {
                      accessorKey: "issuedAt",
                      header: t("billing.issuedAt"),
                      cell: ({ row }) => date(row.original.issuedAt),
                    },
                    {
                      accessorKey: "status",
                      header: t("common.status"),
                      cell: ({ row }) => (
                        <Badge
                          status={row.original.status}
                          label={t("billing." + row.original.status)}
                        />
                      ),
                    },
                    {
                      accessorKey: "grossAmount",
                      header: t("billing.grossAmount"),
                      cell: ({ row }) => money(row.original.grossAmount),
                    },
                    {
                      accessorKey: "voucherUsed",
                      header: t("billing.voucherUsed"),
                      cell: ({ row }) => money(row.original.voucherUsed),
                    },
                    {
                      accessorKey: "amount",
                      header: t("billing.payable"),
                      cell: ({ row }) => money(row.original.amount),
                    },
                    {
                      id: "download",
                      header: t("common.actions"),
                      cell: ({ row }) => (
                        <Button
                          onClick={() =>
                            download(
                              `${row.original.id}.txt`,
                              [
                                t("billing.invoices"),
                                `${t("billing.period")}: ${row.original.period}`,
                                `${t("billing.issuedAt")}: ${date(row.original.issuedAt)}`,
                                `${t("billing.grossAmount")}: ${money(row.original.grossAmount)}`,
                                `${t("billing.voucherUsed")}: ${money(row.original.voucherUsed)}`,
                                `${t("billing.payable")}: ${money(row.original.amount)}`,
                              ].join("\n"),
                            )
                          }
                        >
                          {t("billing.invoiceDownload")}
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : (
                <p className="empty">
                  {t("billing.noInvoice", { period: invoicePeriod || "—" })}
                </p>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
