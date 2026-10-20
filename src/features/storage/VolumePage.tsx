import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import type { StorageVolume } from "../../types/storage";
import type { Kind } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useRegion } from "../../stores/region";
import { useData } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { t } from "../../i18n";
import { date } from "../../lib/date";
import {
  PageHeader,
  Panel,
  Modal,
  DataTable,
  KeyValues,
  Loading,
  ErrorState,
  Empty,
} from "../../components/ui";

type VolumeRow = StorageVolume & { resourceName: string; resourceKind: Kind };
export default function VolumePage() {
  const kind = useLocation().pathname.endsWith("/file") ? "file" : "block";
  const region = useRegion((s) => s.region);
  const [search, setSearch] = useState("");
  const { id, setId } = useDrawer();
  const list = useData<VolumeRow[]>(
    ["storage-volumes", region],
    EP.storageVolumes + query({ region }),
  );
  const detail = useData<VolumeRow>(
    ["storage-volume", id],
    `${EP.storageVolumes}/${id}`,
    { enabled: !!id },
  );
  const rows = (list.data || []).filter(
    (v) =>
      v.kind === kind &&
      `${v.name} ${v.resourceName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const v = detail.data;
  const resourcePath = (row: VolumeRow) =>
    resourceLink({
      kind: row.resourceKind,
      resourceUuid: row.resourceUuid,
      region: row.region,
    });
  return (
    <>
      <PageHeader
        title={t(`storage.kind.${kind}`)}
        subtitle={t("storage.volumeSubtitle")}
      />
      <div className="toolbar">
        <RegionFilter />
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Panel title={t("storage.volumeList")}>
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} />
        ) : rows.length ? (
          <DataTable
            data={rows}
            onRow={(row) => setId(row.id)}
            columns={[
              { accessorKey: "name", header: t("common.name") },
              { accessorKey: "tier", header: t("storage.tier") },
              {
                accessorKey: "sizeGb",
                header: t("storage.sizeGb"),
                cell: ({ row }) => `${row.original.sizeGb} GB`,
              },
              {
                accessorKey: "region",
                header: t("common.region"),
                cell: ({ row }) => t(`common.${row.original.region}`),
              },
              { accessorKey: "resourceName", header: t("storage.attached") },
              { accessorKey: "mountPath", header: t("storage.mountPath") },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
            ]}
          />
        ) : (
          <Empty text={t("storage.noVolumes")} />
        )}
      </Panel>
      <Modal
        drawer
        open={!!id}
        onClose={() => setId("")}
        title={v?.name || t("storage.volumeList")}
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState error={detail.error} />
        ) : v && v.kind === kind ? (
          <div className="stack">
            <Panel title={t("storage.volumeDetails")}>
              <KeyValues
                items={[
                  [t("common.name"), v.name],
                  [t("common.type"), t(`storage.kind.${v.kind}`)],
                  [t("storage.tier"), v.tier],
                  [t("storage.sizeGb"), `${v.sizeGb} GB`],
                  [t("common.region"), t(`common.${v.region}`)],
                  [t("storage.mountPath"), v.mountPath],
                  [t("common.createdAt"), date(v.createdAt)],
                ]}
              />
            </Panel>
            <Panel title={t("storage.attached")}>
              <Link to={resourcePath(v)}>{v.resourceName}</Link>
            </Panel>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
