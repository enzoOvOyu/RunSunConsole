import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Usage, Resource } from "../../types/domain";
import { EP } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useData } from "../shared/hooks";
import { aggregateUsage, allocateCents } from "./cost-analysis";
import { t } from "../../i18n";
import { money, number, unitMoney } from "../../lib/money";
import { Panel, Button, DataTable, Modal, csv } from "../../components/ui";
export function BillingUsageTable({
  usage,
  title,
  billingPeriod = new Date().toISOString().slice(0, 7),
  totalAmount,
}: {
  usage: Usage[];
  title?: string;
  billingPeriod?: string;
  totalAmount?: number;
}) {
  const [id, setId] = useState("");
  const navigate = useNavigate();
  const resources = useData<{ items: Resource[] }>(
    ["billing-resources"],
    EP.resources + "?size=1000&includeDeleted=true",
  );
  const aggregated = useMemo(
    () => aggregateUsage(usage, totalAmount),
    [usage, totalAmount],
  );
  const detailRows = useMemo(() => {
    const rows = usage.filter((row) => row.resourceUuid === id);
    const target = aggregated
      .filter((row) => row.resourceUuid === id)
      .reduce((sum, row) => sum + row.amount, 0);
    const amounts = allocateCents(
      rows.map((row) => row.amount),
      Math.round((target + Number.EPSILON) * 100),
    );
    return rows.map((row, index) => ({ ...row, amount: amounts[index] }));
  }, [usage, aggregated, id]);
  const cols = [
    { accessorKey: "displayId", header: "ID" },
    {
      accessorKey: "kind",
      header: t("common.type"),
      cell: ({ row }: { row: { original: Usage } }) =>
        t("common." + row.original.kind),
    },
    {
      accessorKey: "region",
      header: t("common.region"),
      cell: ({ row }: { row: { original: Usage } }) =>
        t("common." + row.original.region),
    },
    {
      accessorKey: "unit",
      header: t("common.unit"),
      cell: ({ row }: { row: { original: Usage } }) =>
        t("unit." + row.original.unit),
    },
    {
      accessorKey: "quantity",
      header: t("common.count"),
      cell: ({ row }: { row: { original: Usage } }) =>
        number(row.original.quantity, 4),
    },
    {
      accessorKey: "unitPrice",
      header: t("common.price"),
      cell: ({ row }: { row: { original: Usage } }) =>
        unitMoney(row.original.unitPrice),
    },
    {
      accessorKey: "amount",
      header: t("common.amount"),
      cell: ({ row }: { row: { original: Usage } }) =>
        money(row.original.amount),
    },
  ];
  return (
    <>
      <Panel
        title={title || t("common.usage")}
        action={
          <Button
            onClick={() =>
              csv(
                `billing-usage-${billingPeriod}.csv`,
                usage.map((row) => ({
                  ...row,
                  billingPeriod,
                })) as unknown as Record<string, unknown>[],
              )
            }
          >
            {t("common.export")}
          </Button>
        }
      >
        <DataTable
          data={aggregated}
          columns={cols}
          onRow={(row) => setId(row.resourceUuid)}
        />
      </Panel>
      <Modal
        drawer
        open={!!id}
        onClose={() => setId("")}
        title={t("common.usage")}
      >
        <div className="stack">
          <Button
            onClick={() => {
              const eip = usage.find(
                (u) => u.resourceUuid === id && u.kind === "eip",
              );
              if (eip) {
                navigate(
                  `/network/eips?drawer=${id}&region=${eip.region}&project_id=${eip.projectId}`,
                );
                return;
              }
              const r = resources.data?.items.find(
                (r) => r.resourceUuid === id,
              );
              if (r) navigate(resourceLink(r));
            }}
          >
            {t("nav.resources")}
          </Button>
          <Button
            onClick={() =>
              csv(
                `billing-usage-${billingPeriod}-${id}.csv`,
                detailRows.map((row) => ({
                  ...row,
                  billingPeriod,
                })) as unknown as Record<string, unknown>[],
              )
            }
          >
            {t("common.export")}
          </Button>
          <DataTable
            data={detailRows}
            columns={[
              { accessorKey: "usageHour", header: t("common.time") },
              ...cols,
            ]}
          />
        </div>
      </Modal>
    </>
  );
}
