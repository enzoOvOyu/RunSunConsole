import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { OperationLog } from "../../types/domain";
import { EP } from "../../lib/api-client";
import { formatResourceId, resourceLink } from "../../lib/ids";
import { date } from "../../lib/date";
import { t, dt } from "../../i18n";
import { useRegion } from "../../stores/region";
import { useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import {
  Badge,
  DataTable,
  ErrorState,
  Loading,
  PageHeader,
} from "../../components/ui";

export default function OperationLogsPage() {
  const region = useRegion((state) => state.region);
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const query = useData<OperationLog[]>(["operations"], EP.operations, {
    poll: true,
  });
  const rows = (query.data || []).filter((item) => {
    const matchesSearch = [
      formatResourceId("log", item.id),
      item.displayId,
      item.resourceName,
      item.projectName,
      formatResourceId("prj", item.projectId),
    ].some((value) => dt(value).toLowerCase().includes(search.toLowerCase()));
    return (
      item.region === region &&
      (!operation || item.operation === operation) &&
      (!status || item.status === status) &&
      matchesSearch
    );
  });
  const columns: ColumnDef<OperationLog>[] = [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ row }) => (
        <span className="resource-id">
          {formatResourceId("log", row.original.id)}
        </span>
      ),
    },
    {
      accessorKey: "operation",
      header: t("operation.action"),
      cell: ({ row }) => {
        const Icon =
          row.original.operation === "create"
            ? Plus
            : row.original.operation === "delete"
              ? Trash2
              : row.original.operation === "start"
                ? Play
                : Pause;
        return (
          <span className="row">
            <Icon size={15} aria-hidden="true" />
            {t(`operation.${row.original.operation}`)}
          </span>
        );
      },
    },
    {
      accessorKey: "displayId",
      header: t("operation.resource"),
      cell: ({ row }) => (
        <Link
          to={resourceLink({
            kind: row.original.kind,
            resourceUuid: row.original.resourceUuid,
            region: row.original.region,
          })}
        >
          <strong>{row.original.displayId}</strong>
          <br />
          <small>{dt(row.original.resourceName)}</small>
        </Link>
      ),
    },
    {
      accessorKey: "kind",
      header: t("common.type"),
      cell: ({ row }) => t(`common.${row.original.kind}`),
    },
    {
      accessorKey: "projectName",
      header: t("common.project"),
      cell: ({ row }) => (
        <span>
          {dt(row.original.projectName)}
          <br />
          <small className="resource-id">
            {formatResourceId("prj", row.original.projectId)}
          </small>
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => {
        const state = row.original.status;
        const badgeStatus =
          state === "processing"
            ? "provisioning"
            : state === "failed"
              ? "error"
              : state === "canceled"
                ? "stopped"
                : "running";
        return (
          <Badge status={badgeStatus} label={t(`operation.status.${state}`)} />
        );
      },
    },
    {
      accessorKey: "startedAt",
      header: t("operation.startedAt"),
      cell: ({ row }) => date(row.original.startedAt),
    },
  ];
  return (
    <>
      <PageHeader
        title={t("nav.operation-logs")}
        subtitle={t("pageDescription.operationLogs")}
        actions={<ClipboardList size={18} aria-hidden="true" />}
      />
      <div className="toolbar">
        <RegionFilter />
        <select
          aria-label={t("operation.action")}
          value={operation}
          onChange={(event) => setOperation(event.target.value)}
        >
          <option value="">{t("common.all")}</option>
          <option value="create">{t("operation.create")}</option>
          <option value="delete">{t("operation.delete")}</option>
          <option value="start">{t("operation.start")}</option>
          <option value="stop">{t("operation.stop")}</option>
        </select>
        <select
          aria-label={t("common.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t("common.all")}</option>
          {(["processing", "succeeded", "failed", "canceled"] as const).map(
            (value) => (
              <option key={value} value={value}>
                {t(`operation.status.${value}`)}
              </option>
            ),
          )}
        </select>
        <input
          className="input search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("common.search")}
        />
      </div>
      <div className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            empty={t("operation.empty")}
          />
        )}
      </div>
    </>
  );
}
