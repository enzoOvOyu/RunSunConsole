import { poolDisplayName } from "../../../lib/gpu-labels";
import { precisionLabel } from "../../../lib/inference-precision";
import { inferenceEndpoint } from "../../../lib/inference-endpoint";
import type { ColumnDef } from "@tanstack/react-table";
import type { ResourceOf } from "../../../types/domain";
import { ResourceListShell, ResourceName } from "../shared/ResourceListShell";
import { money } from "../../../lib/money";
import { Badge, Button, copy } from "../../../components/ui";
import { t } from "../../../i18n";
export default function InferencePage() {
  const columns: ColumnDef<ResourceOf<"inference">>[] = [
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
      id: "model",
      header: t("resource.model"),
      cell: ({ row }) => row.original.spec.modelRef,
    },
    {
      id: "engine",
      header: t("resource.engine"),
      cell: ({ row }) => row.original.spec.engine,
    },
    {
      id: "quantization",
      header: t("field.quantization"),
      cell: ({ row }) => precisionLabel(row.original.spec.quantization),
    },
    {
      id: "gpuPerReplica",
      header: t("resource.gpuPerReplica"),
      cell: ({ row }) => row.original.spec.gpuPerReplica,
    },
    {
      id: "replicas",
      header: t("resource.replicas"),
      cell: ({ row }) => row.original.spec.replicas,
    },
    {
      id: "gpu",
      header: t("resource.gpu"),
      cell: ({ row }) =>
        `${poolDisplayName(row.original.nodePool)} × ${row.original.spec.gpuPerReplica}`,
    },
    {
      id: "endpoint",
      header: t("common.endpoint"),
      cell: ({ row }) => (
        <Button
          variant="default"
          title={inferenceEndpoint(row.original)}
          onClick={(event) => {
            event.stopPropagation();
            void copy(inferenceEndpoint(row.original));
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {t("common.copy")}
        </Button>
      ),
    },
    {
      id: "hourly",
      header: t("resource.hourly"),
      cell: ({ row }) => money(row.original.cost?.perHour || 0),
    },
  ];
  return (
    <ResourceListShell
      kind="inference"
      columns={columns}
      facets={[
        {
          id: "model",
          label: t("resource.model"),
          value: (r) => r.spec.modelRef,
        },
        {
          id: "engine",
          label: t("resource.engine"),
          value: (r) => r.spec.engine,
        },
        {
          id: "quantization",
          label: t("field.quantization"),
          value: (r) => precisionLabel(r.spec.quantization),
          format: (value) => value.toUpperCase(),
        },
      ]}
    />
  );
}
