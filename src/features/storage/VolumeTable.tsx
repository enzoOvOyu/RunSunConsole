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
      pageSizeOptions
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
            kind === "file" && row.original.accessClients?.length ? (
              <div className="storage-resource-cell">
                <strong>{dt(row.original.accessClients[0].name)}</strong>
                <small>{row.original.accessClients[0].displayId} · {t("storage.authorizedClients")}</small>
              </div>
            ) : row.original.resourceName ? (
              <div className="storage-resource-cell">
                <strong>{dt(row.original.resourceName)}</strong>
                <small>
                  {row.original.resourceKind === "vgpu"
                    ? t("storage.kubernetesCluster")
                    : t(kind === "file" ? "storage.fileLegacyAssociation" : "storage.computeResource")}
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
                header: t("storage.fileProtocol"),
                cell: () => "NFSv4.1",
              },
              {
                accessorKey: "fileAccess",
                header: t("storage.fileAccessMode"),
                cell: ({ row }: { row: { original: VolumeRow } }) =>
                  row.original.fileAccess
                    ? `${t(row.original.fileAccess.accessMode === "read_write" ? "storage.fileReadWrite" : "storage.fileReadOnly")} · ${row.original.fileAccess.allowedCidr}`
                    : t(row.original.resourceUuid ? "storage.fileManagedAccess" : "storage.fileUnconfigured"),
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
          header: t("storage.moreActions"),
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
