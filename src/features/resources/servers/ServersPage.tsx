import type { ColumnDef } from "@tanstack/react-table";
import type { ResourceOf } from "../../../types/domain";
import { ResourceListShell, ResourceName } from "../shared/ResourceListShell";
import { money } from "../../../lib/money";
import { Badge } from "../../../components/ui";
import { t } from "../../../i18n";
import { duration } from "../../../lib/date";
export default function ServersPage() {
  const columns: ColumnDef<ResourceOf<"gpu_vm">>[] = [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => <ResourceName resource={row.original} />,
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => (
        <Badge
          status={row.original.deletedAt ? "released" : row.original.status}
        />
      ),
    },
    {
      accessorKey: "region",
      header: t("common.region"),
      cell: ({ row }) => t(`common.${row.original.region}`),
    },
    { accessorKey: "nodePool", header: t("resource.pool") },
    {
      id: "family",
      header: t("resource.specFamily"),
      cell: ({ row }) => {
        const { gpuPerInstance, vcpu, memoryGb } = row.original.spec;
        return `gpu.${gpuPerInstance}x${row.original.nodePool.split("_")[0].toLowerCase()}.${vcpu}c.${memoryGb}g`;
      },
    },
    {
      id: "image",
      header: t("resource.image"),
      cell: ({ row }) => row.original.spec.imageRef,
    },
    {
      id: "gpu",
      header: t("resource.gpu"),
      cell: ({ row }) =>
        `${row.original.spec.gpuModel} × ${row.original.spec.gpuCount}`,
    },
    {
      id: "cpu",
      header: t("resource.cpu"),
      cell: ({ row }) =>
        `${row.original.spec.vcpu} / ${row.original.spec.memoryGb} GB`,
    },
    {
      id: "ip",
      header: t("resource.privateIp"),
      cell: ({ row }) => row.original.privateIp || "—",
    },
    {
      id: "uptime",
      header: t("resource.uptime"),
      cell: ({ row }) =>
        row.original.runningSince
          ? duration(
              (Date.now() - new Date(row.original.runningSince).getTime()) /
                1000,
            )
          : "—",
    },
    {
      id: "hourly",
      header: t("resource.hourly"),
      cell: ({ row }) => money(row.original.cost?.perHour || 0),
    },
  ];
  return (
    <ResourceListShell
      kind="gpu_vm"
      columns={columns}
      facets={[
        { id: "pool", label: t("resource.pool"), value: (r) => r.nodePool },
        {
          id: "cards",
          label: t("resource.gpuPerInstance"),
          value: (r) => String(r.spec.gpuPerInstance),
          format: (value) => `${value} GPU`,
        },
      ]}
    />
  );
}
