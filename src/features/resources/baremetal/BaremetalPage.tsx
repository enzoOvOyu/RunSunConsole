import type { ColumnDef } from "@tanstack/react-table";
import type { ResourceOf } from "../../../types/domain";
import { ResourceListShell, ResourceName } from "../shared/ResourceListShell";
import { unitMoney } from "../../../lib/money";
import { Badge } from "../../../components/ui";
import { t } from "../../../i18n";
import { size } from "../../../lib/money";
import { gpuModelDisplayName } from "../../../lib/gpu-labels";
export default function BaremetalPage() {
  const columns: ColumnDef<ResourceOf<"gpu_baremetal">>[] = [
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
      id: "raid",
      header: t("resource.raid"),
      cell: ({ row }) => row.original.spec.raidLevel.toUpperCase(),
    },
    {
      id: "image",
      header: t("resource.image"),
      cell: ({ row }) => row.original.spec.imageRef,
    },
    {
      id: "count",
      header: t("resource.machineCount"),
      cell: ({ row }) => row.original.spec.machineCount,
    },
    {
      id: "gpuModel",
      header: t("resource.gpuModel"),
      cell: ({ row }) => gpuModelDisplayName(row.original.spec.gpuModel),
    },
    {
      id: "gpu",
      header: t("resource.gpuQuantity"),
      cell: ({ row }) => row.original.spec.gpuCount,
    },
    {
      id: "cpu",
      header: t("baremetal.cpuMemoryPerMachine"),
      cell: ({ row }) =>
        `${row.original.spec.cpuModel} / ${size(row.original.spec.memoryGb)}`,
    },
    {
      id: "memory",
      header: t("baremetal.clusterMemory"),
      cell: ({ row }) =>
        size(row.original.spec.memoryGb * row.original.spec.machineCount),
    },
    {
      id: "nvme",
      header: t("baremetal.nvmePerMachine"),
      cell: ({ row }) => size(row.original.spec.localNvmeGb),
    },
    {
      id: "hourly",
      header: t("common.price") + " / " + t("unit.per_machine_hour"),
      cell: ({ row }) => unitMoney(row.original.cost?.unitPrice || 0),
    },
  ];
  return (
    <ResourceListShell
      kind="gpu_baremetal"
      columns={columns}
      facets={[
        {
          id: "machine",
          label: t("resource.gpuModel"),
          value: (r) => gpuModelDisplayName(r.spec.gpuModel),
        },
        {
          id: "raid",
          label: t("resource.raid"),
          value: (r) => r.spec.raidLevel,
          format: (value) => value.toUpperCase(),
        },
      ]}
    />
  );
}
