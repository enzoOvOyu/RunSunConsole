import type { ColumnDef } from "@tanstack/react-table";
import type { ResourceOf } from "../../../types/domain";
import { ResourceListShell, ResourceName } from "../shared/ResourceListShell";
import { money } from "../../../lib/money";
import { Badge } from "../../../components/ui";
import { t } from "../../../i18n";
import { poolDisplayName } from "../../../lib/gpu-labels";
export default function VgpuPage() {
  const columns: ColumnDef<ResourceOf<"vgpu">>[] = [
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
    {
      id: "version",
      header: t("resource.k8s"),
      cell: ({ row }) => row.original.spec.k8sVersion,
    },
    {
      id: "pool",
      header: t("resource.pool"),
      cell: ({ row }) =>
        row.original.spec.nodePools
          .map((p) => poolDisplayName(p.poolCode))
          .join(", "),
    },
    {
      id: "controlTier",
      header: t("field.controlPlaneTier"),
      cell: ({ row }) => t(`spec.${row.original.spec.controlPlaneTier}`),
    },
    {
      id: "storageClass",
      header: t("resource.storageClass"),
      cell: ({ row }) => row.original.spec.storageClass,
    },
    {
      id: "nodes",
      header: t("resource.nodeCount"),
      cell: ({ row }) =>
        row.original.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0),
    },
    {
      id: "gpu",
      header: t("resource.gpu"),
      cell: ({ row }) => row.original.spec.gpuCount,
    },
    {
      id: "slicing",
      header: t("resource.slicing"),
      cell: ({ row }) =>
        row.original.spec.nodePools
          .map(
            (p) =>
              t(`spec.${p.slicingPolicy}`) +
              (p.slicingPolicy === "mig" ? ` ${p.migProfile}` : ""),
          )
          .join(", "),
    },
    {
      id: "hourly",
      header: t("resource.hourly"),
      cell: ({ row }) => money(row.original.cost?.perHour || 0),
    },
  ];
  return (
    <ResourceListShell
      kind="vgpu"
      columns={columns}
      facets={[
        {
          id: "tier",
          label: t("field.controlPlaneTier"),
          value: (r) => r.spec.controlPlaneTier,
          format: (value) => t(`spec.${value}`),
        },
        {
          id: "slicing",
          label: t("resource.slicing"),
          value: (r) => r.spec.nodePools[0]?.slicingPolicy || "none",
          format: (value) => t(`spec.${value}`),
        },
      ]}
    />
  );
}
