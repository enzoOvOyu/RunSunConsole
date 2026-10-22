import type { Bucket } from "../../types/domain";
import { formatResourceId } from "../../lib/ids";
import { date } from "../../lib/date";
import { size } from "../../lib/money";
import { t } from "../../i18n";
import { Badge, Button, DataTable } from "../../components/ui";

type Props = {
  buckets: Bucket[];
  projectName: (id?: string) => string;
  onDetails: (bucket: Bucket) => void;
};

export function BucketTable({ buckets, projectName, onDetails }: Props) {
  return (
    <DataTable
      data={buckets}
      onRow={onDetails}
      columns={[
        {
          accessorKey: "name",
          header: t("common.name"),
          cell: ({ row }) => (
            <div className="storage-resource-cell">
              <strong>{row.original.name}</strong>
              <small className="resource-id">
                {formatResourceId("obj", row.original.id)}
              </small>
            </div>
          ),
        },
        {
          accessorKey: "region",
          header: t("common.region"),
          cell: ({ row }) => t("common." + row.original.region),
        },
        {
          accessorKey: "projectId",
          header: t("common.project"),
          cell: ({ row }) => (
            <div className="storage-project-cell">
              <span>{projectName(row.original.projectId)}</span>
              <small className="resource-id">
                {formatResourceId("prj", row.original.projectId || "")}
              </small>
            </div>
          ),
        },
        {
          accessorKey: "storageClass",
          header: t("storage.tier"),
          cell: ({ row }) => row.original.storageClass || "STANDARD",
        },
        {
          accessorKey: "quotaGb",
          header: t("storage.bucketLimit"),
          cell: ({ row }) => size(row.original.quotaGb),
        },
        {
          id: "count",
          header: t("storage.objects"),
          cell: ({ row }) => row.original.objects.length,
        },
        {
          id: "capacity",
          header: t("storage.capacity"),
          cell: ({ row }) =>
            size(
              row.original.objects.reduce(
                (bytes, object) => bytes + object.size,
                0,
              ) / 1e9,
            ),
        },
        {
          accessorKey: "createdAt",
          header: t("common.createdAt"),
          cell: ({ row }) => date(row.original.createdAt),
        },
        {
          accessorKey: "status",
          header: t("common.status"),
          cell: ({ row }) => (
            <Badge status={row.original.status} label={t("common.active")} />
          ),
        },
        {
          accessorKey: "access",
          header: t("storage.accessPolicy"),
          cell: ({ row }) => t("common." + row.original.access),
        },
        {
          id: "operation",
          header: t("common.action"),
          cell: ({ row }) => (
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onDetails(row.original);
              }}
            >
              {t("common.details")}
            </Button>
          ),
        },
      ]}
    />
  );
}
