import type { StorageVolume } from "../../types/storage";
import type { VolumeRow } from "../shared/storageView";
import { formatResourceId } from "../../lib/ids";
import { date } from "../../lib/date";
import { t, dt } from "../../i18n";
import { Badge, Button, DataTable } from "../../components/ui";

type Props = {
  rows: VolumeRow[];
  kind: StorageVolume["kind"];
  projectName: (id: string) => string;
  onDetails: (id: string) => void;
};

export function VolumeTable({ rows, kind, projectName, onDetails }: Props) {
  return (
    <DataTable
      data={rows}
      onRow={(row) => onDetails(row.id)}
      columns={[
        {
          accessorKey: "name",
          header: t(kind === "file" ? "storage.fileSystem" : "common.name"),
          cell: ({ row }) => (
            <div className="storage-resource-cell">
              <strong>{row.original.name}</strong>
              <small className="resource-id">
                {formatResourceId(
                  kind === "block" ? "blk" : "fil",
                  row.original.id,
                )}
              </small>
            </div>
          ),
        },
        {
          accessorKey: "sizeGb",
          header: t(
            kind === "file" ? "storage.capacityOrQuota" : "storage.sizeGb",
          ),
          cell: ({ row }) => `${row.original.sizeGb.toLocaleString()} GB`,
        },
        {
          accessorKey: "tier",
          header: t(
            kind === "block" ? "storage.performanceProfile" : "storage.tier",
          ),
          cell: ({ row }) => (
            <div className="storage-profile-cell">
              <strong>{t(`storage.profile.${row.original.tier}`)}</strong>
              <small>{row.original.tier}</small>
            </div>
          ),
        },
        ...(kind === "block"
          ? [
              {
                accessorKey: "zone",
                header: t("eks.availableZones"),
                cell: ({ row }: { row: { original: VolumeRow } }) =>
                  row.original.zone || `${row.original.region}-a`,
              },
            ]
          : [
              {
                accessorKey: "region",
                header: t("common.region"),
                cell: ({ row }: { row: { original: VolumeRow } }) =>
                  t(`common.${row.original.region}`),
              },
            ]),
        {
          accessorKey: "status",
          header: t("common.status"),
          cell: ({ row }) => (
            <Badge
              status={row.original.resourceUuid ? "in_use" : "available"}
              label={t(
                row.original.resourceUuid
                  ? "storage.inUse"
                  : "storage.available",
              )}
            />
          ),
        },
        {
          accessorKey: "resourceName",
          header: t(
            kind === "file" ? "storage.linkedCompute" : "storage.attached",
          ),
          cell: ({ row }) =>
            row.original.resourceName ? (
              <div className="storage-resource-cell">
                <strong>{dt(row.original.resourceName)}</strong>
                <small>
                  {row.original.resourceKind === "vgpu"
                    ? t("storage.kubernetesCluster")
                    : t("storage.computeResource")}
                </small>
              </div>
            ) : (
              t("storage.unattached")
            ),
        },
        ...(kind === "file"
          ? [
              {
                accessorKey: "mountPath",
                header: t("storage.accessPath"),
                cell: ({ row }: { row: { original: VolumeRow } }) =>
                  row.original.mountPath ? (
                    <code className="storage-mount-path">
                      {row.original.mountPath}
                    </code>
                  ) : (
                    "—"
                  ),
              },
            ]
          : []),
        {
          accessorKey: "projectId",
          header: t("common.project"),
          cell: ({ row }) => (
            <div className="storage-project-cell">
              <span>{projectName(row.original.projectId)}</span>
              <small className="resource-id">
                {formatResourceId("prj", row.original.projectId)}
              </small>
            </div>
          ),
        },
        {
          accessorKey: "createdAt",
          header: t("common.createdAt"),
          cell: ({ row }) => date(row.original.createdAt),
        },
        {
          id: "operation",
          header: t("common.action"),
          cell: ({ row }) => (
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onDetails(row.original.id);
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
