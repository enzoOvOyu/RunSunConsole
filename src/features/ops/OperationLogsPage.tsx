import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Search } from "lucide-react";
import { Link } from "react-router-dom";
import type { OperationLog } from "../../types/domain";
import { EP } from "../../lib/api-client";
import { formatResourceId } from "../../lib/ids";
import { date } from "../../lib/date";
import { t, dt } from "../../i18n";
import { useRegion } from "../../stores/region";
import { useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
} from "../../components/ui";

const operationTypes = ["create", "delete", "start", "stop", "update"] as const;
const operationLabel = (row: OperationLog) => {
  const eventKey = `operation.event.${row.actionName}`;
  const translated = t(eventKey);
  return translated === eventKey ? t(`operation.${row.operation}`) : translated;
};

export default function OperationLogsPage() {
  const region = useRegion((state) => state.region);
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OperationLog | null>(null);
  const query = useData<OperationLog[]>(["operations"], EP.operations, {
    poll: true,
  });
  const rows = (query.data || []).filter((item) => {
    const matchesSearch = [
      item.eventId,
      formatResourceId("log", item.eventId),
      item.actor,
      item.displayId,
      item.resourceName,
      item.projectName,
      item.projectId,
      item.eventSource,
      item.actionName,
    ].some((value) => dt(value).toLowerCase().includes(search.trim().toLowerCase()));
    return (
      item.region === region &&
      (!operation || item.operation === operation) &&
      (!status || item.status === status) &&
      matchesSearch
    );
  });
  const columns: ColumnDef<OperationLog>[] = [
    {
      accessorKey: "actor",
      header: t("operation.actor"),
      cell: ({ row }) => <span className="resource-id">{row.original.actor}</span>,
    },
    {
      accessorKey: "startedAt",
      header: t("operation.eventTime"),
      cell: ({ row }) => date(row.original.startedAt),
    },
    {
      accessorKey: "actionName",
      header: t("operation.action"),
      cell: ({ row }) => <strong>{operationLabel(row.original)}</strong>,
    },
    {
      accessorKey: "resourceName",
      header: t("operation.target"),
      cell: ({ row }) => {
        const item = row.original;
        const content = (
          <>
            <strong>{dt(item.resourceName)}</strong>
            <br />
            <small className="resource-id">{item.displayId}</small>
          </>
        );
        return item.targetHref ? <Link to={item.targetHref}>{content}</Link> : content;
      },
    },
    {
      accessorKey: "projectName",
      header: t("common.project"),
      cell: ({ row }) => (
        <span>
          {dt(row.original.projectName)}
          <br />
          <small className="resource-id">{formatResourceId("prj", row.original.projectId)}</small>
        </span>
      ),
    },
    {
      accessorKey: "region",
      header: t("operation.region"),
      cell: ({ row }) => t(`common.${row.original.region}`),
    },
    {
      accessorKey: "status",
      header: t("operation.result"),
      cell: ({ row }) => {
        const state = row.original.status;
        const badgeStatus = state === "processing" ? "provisioning" : state === "failed" ? "error" : state === "canceled" ? "stopped" : "running";
        return <Badge status={badgeStatus} label={t(`operation.status.${state}`)} />;
      },
    },
    {
      id: "details",
      header: t("operation.eventId"),
      cell: ({ row }) => (
        <Button variant="ghost" className="resource-id" onClick={() => setSelected(row.original)}>
          <Search size={14} aria-hidden="true" />
          {formatResourceId("log", row.original.eventId)}
        </Button>
      ),
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
        <select aria-label={t("operation.action")} value={operation} onChange={(event) => setOperation(event.target.value)}>
          <option value="">{t("common.all")}</option>
          {operationTypes.map((value) => <option key={value} value={value}>{t(`operation.${value}`)}</option>)}
        </select>
        <select aria-label={t("operation.result")} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t("common.all")}</option>
          {(["processing", "succeeded", "failed", "canceled"] as const).map((value) => (
            <option key={value} value={value}>{t(`operation.status.${value}`)}</option>
          ))}
        </select>
        <input
          className="input search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("operation.searchPlaceholder")}
        />
      </div>
      <div className="panel">
        {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} /> : (
          <DataTable data={rows} columns={columns} empty={t("operation.empty")} />
        )}
      </div>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        drawer
        title={selected ? operationLabel(selected) : t("operation.details")}
        description={selected ? `${selected.eventSource} · ${date(selected.startedAt)}` : undefined}
      >
        {selected && (
          <div className="stack">
            <section className="panel">
              <h3>{t("operation.eventMetadata")}</h3>
              <dl className="kv">
                <div><dt>{t("operation.eventId")}</dt><dd className="resource-id">{formatResourceId("log", selected.eventId)}</dd></div>
                <div><dt>{t("operation.actor")}</dt><dd>{selected.actor}</dd></div>
                <div><dt>{t("operation.eventTime")}</dt><dd>{date(selected.startedAt)}</dd></div>
                <div><dt>{t("operation.result")}</dt><dd><Badge status={selected.status === "failed" ? "error" : selected.status === "processing" ? "provisioning" : "running"} label={t(`operation.status.${selected.status}`)} /></dd></div>
                <div><dt>{t("operation.target")}</dt><dd><Link to={selected.targetHref}>{dt(selected.resourceName)} · {selected.displayId}</Link></dd></div>
                <div><dt>{t("common.project")}</dt><dd>{dt(selected.projectName)} · {formatResourceId("prj", selected.projectId)}</dd></div>
                <div><dt>{t("operation.region")}</dt><dd>{t(`common.${selected.region}`)}</dd></div>
                <div><dt>{t("operation.source")}</dt><dd>{selected.eventSource}</dd></div>
              </dl>
            </section>
            <section className="panel">
              <h3>{t("operation.requestParameters")}</h3>
              <pre>{JSON.stringify(selected.requestParameters, null, 2)}</pre>
            </section>
            {selected.errorDetails && (
              <section className="panel">
                <h3>{t("operation.errorDetails")}</h3>
                <p>{dt(selected.errorDetails)}</p>
              </section>
            )}
            <section className="panel">
              <h3>{t("operation.relatedEvents")}</h3>
              <ul>{selected.relatedEventIds.map((id) => <li className="resource-id" key={id}>{formatResourceId("log", id)}</li>)}</ul>
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
