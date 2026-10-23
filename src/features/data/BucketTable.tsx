import type { Bucket } from "../../types/domain";
import { formatResourceId } from "../../lib/ids";
import { date } from "../../lib/date";
import { size } from "../../lib/money";
import { t } from "../../i18n";
import { Button, DataTable, copy } from "../../components/ui";

type Props = {
  buckets: Bucket[];
  projectName: (id?: string) => string;
  onDetails: (bucket: Bucket) => void;
  onManage: (bucket: Bucket) => void;
  onFiles: (bucket: Bucket) => void;
};

export function BucketTable({
  buckets,
  projectName,
  onDetails,
  onManage,
  onFiles,
}: Props) {
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
          accessorKey: "storageClass",
          header: t("storage.tier"),
          cell: ({ row }) => row.original.storageClass || "STANDARD",
        },
        {
          id: "fileInterface",
          header: t("storage.s3FilesTitle"),
          cell: ({ row }) => (
            <Button onClick={(event) => {
              event.stopPropagation();
              onFiles(row.original);
            }}>
              {t(row.original.fileInterface ? "storage.s3FilesPreviewOnly" : "storage.s3FilesUnconfigured")}
            </Button>
          ),
        },
        {
          accessorKey: "access",
          header: t("storage.accessPolicy"),
          cell: ({ row }) => t("common." + row.original.access),
        },
        {
          accessorKey: "createdAt",
          header: t("common.createdAt"),
          cell: ({ row }) => date(row.original.createdAt),
        },
        {
          id: "operation",
          header: t("storage.moreActions"),
          cell: ({ row }) => (
            <div className="row">
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onManage(row.original);
                }}
              >
                {t("storage.management")}
              </Button>
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  void copy(formatResourceId("obj", row.original.id));
                }}
              >
                {t("storage.copyId")}
              </Button>
            </div>
          ),
        },
      ]}
    />
  );
}
