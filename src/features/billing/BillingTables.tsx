import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Usage, Resource } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useData } from "../shared/hooks";
import { t } from "../../i18n";
import { money, number, unitMoney } from "../../lib/money";
import {
  Panel,
  Button,
  DataTable,
  Modal,
  Loading,
  csv,
} from "../../components/ui";
export function aggregateUsage(rows: Usage[]) {
  const map = new Map<string, Usage>();
  for (const u of rows) {
    const key = `${u.resourceUuid}-${u.unit}-${u.unitPrice}`;
    const old = map.get(key);
    if (old) {
      old.amount += u.amount;
      old.quantity += u.quantity;
    } else map.set(key, { ...u });
  }
  return [...map.values()];
}
export function BillingUsageTable({
  usage,
  title,
  billingPeriod = new Date().toISOString().slice(0, 7),
  region,
}: {
  usage: Usage[];
  title?: string;
  billingPeriod?: string;
  region?: string | null;
}) {
  const [id, setId] = useState("");
  const navigate = useNavigate();
  const resources = useData<{ items: Resource[] }>(
    ["billing-resources"],
    EP.resources + "?size=1000&includeDeleted=true",
  );
  const detail = useData<Usage[]>(
    ["usage-detail", id, billingPeriod, region],
    EP.usage +
      query({
        resource_id: id,
        billing_period: billingPeriod,
        region,
      }),
    { enabled: !!id },
  );
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
          data={aggregateUsage(usage)}
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
          {detail.isPending ? (
            <Loading />
          ) : (
            <>
              <Button
                onClick={() =>
                  csv(
                    `billing-usage-${billingPeriod}-${id}.csv`,
                    (detail.data || []).map((row) => ({
                      ...row,
                      billingPeriod,
                    })) as unknown as Record<string, unknown>[],
                  )
                }
              >
                {t("common.export")}
              </Button>
              <DataTable
                data={detail.data || []}
                columns={[
                  { accessorKey: "usageHour", header: t("common.time") },
                  ...cols,
                ]}
              />
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
