import { useState } from "react";
import type { Voucher } from "../../types/domain";
import { EP } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { t } from "../../i18n";
import { money } from "../../lib/money";
import { date } from "../../lib/date";
import {
  PageHeader,
  Panel,
  DataTable,
  Badge,
  Modal,
  KeyValues,
  Loading,
  ErrorState,
} from "../../components/ui";
export default function VouchersPage() {
  const q = useData<Voucher[]>(["vouchers"], EP.vouchers);
  const [selected, setSelected] = useState<Voucher | null>(null);
  return (
    <>
      <PageHeader title={t("nav.vouchers")} />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <Panel title={t("nav.vouchers")}>
          <DataTable
            data={q.data}
            onRow={setSelected}
            columns={[
              { accessorKey: "name", header: t("common.name") },
              {
                accessorKey: "faceValue",
                header: t("billing.face"),
                cell: ({ row }) => money(row.original.faceValue),
              },
              {
                accessorKey: "remaining",
                header: t("billing.remaining"),
                cell: ({ row }) => money(row.original.remaining),
              },
              {
                accessorKey: "expiresAt",
                header: t("billing.expires"),
                cell: ({ row }) => date(row.original.expiresAt),
              },
              {
                id: "status",
                header: t("common.status"),
                cell: ({ row }) =>
                  new Date(row.original.expiresAt) < new Date() ? (
                    <span className="muted">{t("billing.expired")}</span>
                  ) : (
                    <Badge status="active" />
                  ),
              },
            ]}
          />
        </Panel>
      )}
      <Modal
        drawer
        small
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || t("nav.vouchers")}
      >
        {selected && (
          <div className="stack">
            <KeyValues
              items={[
                [t("billing.face"), money(selected.faceValue)],
                [t("billing.remaining"), money(selected.remaining)],
                [t("billing.expires"), date(selected.expiresAt)],
                [
                  t("billing.scope"),
                  selected.regions.map((r) => t("common." + r)).join(" / "),
                ],
                [
                  t("common.type"),
                  selected.kinds.map((k) => t("common." + k)).join(" / "),
                ],
              ]}
            />
            <DataTable
              data={selected.redemptions}
              columns={[
                {
                  accessorKey: "at",
                  header: t("common.time"),
                  cell: ({ row }) => date(row.original.at),
                },
                {
                  accessorKey: "amount",
                  header: t("common.amount"),
                  cell: ({ row }) => money(row.original.amount),
                },
                { accessorKey: "referenceId", header: t("billing.reference") },
              ]}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
