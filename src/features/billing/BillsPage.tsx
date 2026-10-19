import { useUrlState } from "../shared/useUrlState";
import type { Usage, Transaction } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { t } from "../../i18n";
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
export default function BillsPage() {
  const [period, setPeriod] = useUrlState(
    "billing_period",
    new Date().toISOString().slice(0, 7),
  );
  const summary = useData<{
    month: number;
    voucherUsed: number;
    balance: number;
  }>(
    ["billing-summary", period],
    EP.summary + query({ billing_period: period }),
  );
  const usage = useData<Usage[]>(
    ["billing-usage", period],
    EP.usage + query({ billing_period: period }),
  );
  const transactions = useData<Transaction[]>(
    ["billing-transactions", period],
    EP.transactions + query({ billing_period: period }),
  );
  const invoices = useData<
    { id: string; period: string; status: string; amount: number }[]
  >(["invoices"], EP.invoices);
  return (
    <>
      <PageHeader title={t("nav.bills")} />
      <div className="toolbar">
        <label className="row">
          {t("billing.period")}
          <input
            className="input"
            type="month"
            max={new Date().toISOString().slice(0, 7)}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <small>{t("common.allRegions")} · USD</small>
      </div>
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} />
      ) : (
        <div className="grid grid-3">
          {[
            [t("billing.payable"), summary.data.month],
            [t("billing.voucherUsed"), summary.data.voucherUsed],
            [t("common.balance"), summary.data.balance],
          ].map(([label, value]) => (
            <div className="panel stat" key={label}>
              <small>{label}</small>
              <div className="stat-value">{money(Number(value))}</div>
              <small>{t("common.scope")}</small>
            </div>
          ))}
        </div>
      )}
      <div className="stack section-gap">
        <BillingUsageTable usage={usage.data || []} />
        <Panel title={t("common.transactions")}>
          <TransactionTable rows={transactions.data || []} />
        </Panel>
        <Panel title={t("billing.invoices")}>
          <DataTable
            data={invoices.data || []}
            columns={[
              { accessorKey: "id", header: "ID" },
              { accessorKey: "period", header: t("billing.period") },
              {
                accessorKey: "status",
                header: t("common.status"),
                cell: ({ row }) => <Badge status={row.original.status} />,
              },
              {
                accessorKey: "amount",
                header: t("common.amount"),
                cell: ({ row }) => money(row.original.amount),
              },
              {
                id: "download",
                header: t("common.actions"),
                cell: ({ row }) => (
                  <Button
                    disabled={row.original.status === "pending"}
                    onClick={() =>
                      download(
                        `${row.original.id}.txt`,
                        `${t("billing.invoices")}\n${row.original.id}\n${row.original.period}\nUSD ${row.original.amount.toFixed(2)}`,
                      )
                    }
                  >
                    {t("billing.invoiceDownload")}
                  </Button>
                ),
              },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
