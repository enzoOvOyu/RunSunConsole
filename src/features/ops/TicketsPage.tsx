import { useUrlState } from "../shared/useUrlState";
import { useState } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  Link,
} from "react-router-dom";
import type { Ticket, Resource } from "../../types/domain";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { EP, post, patch, query } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useAction, useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { date } from "../../lib/date";
import {
  PageHeader,
  Button,
  DataTable,
  Badge,
  Modal,
  Field,
  Panel,
  Loading,
  ErrorState,
} from "../../components/ui";
export default function TicketsPage() {
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const [params] = useSearchParams();
  const [open, setOpen] = useState(!!params.get("new"));
  const [title, setTitle] = useState(
    params.get("new") === "quota"
      ? [
          t("data.ticket.quota"),
          ...(["vpc", "subnet", "security_group", "tunnel", "ip"].includes(
            params.get("metric") || "",
          )
            ? [
                t("quota." + params.get("metric")),
                t("common." + (params.get("region") || region)),
              ]
            : []),
        ].join(" · ")
      : "",
  );
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [resource, setResource] = useState("");
  const [status, setStatus] = useUrlState("status");
  const [search, setSearch] = useUrlState("q");
  const q = useData<Ticket[]>(
    ["tickets", region, status],
    EP.tickets + query({ region, status }),
  );
  const resources = useData<{ items: Resource[] }>(
    ["ticket-resources", region],
    EP.resources + query({ region, size: 1000 }),
  );
  const { run, busy } = useAction();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t("nav.tickets")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setOpen(true)}
          >
            {t("tickets.new")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter />
        <select
          aria-label={t("common.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t("common.all")}</option>
          {["open", "closed"].map((s) => (
            <option key={s} value={s}>
              {t("common." + s)}
            </option>
          ))}
        </select>
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={(q.data || []).filter((t) =>
              dt(t.title).toLowerCase().includes(search.toLowerCase()),
            )}
            onRow={(ticket) => navigate("/ops/tickets/" + ticket.id)}
            columns={[
              {
                accessorKey: "title",
                header: t("tickets.title"),
                cell: ({ row }) => dt(row.original.title),
              },
              {
                accessorKey: "status",
                header: t("common.status"),
                cell: ({ row }) => <Badge status={row.original.status} />,
              },
              {
                accessorKey: "priority",
                header: t("tickets.priority"),
                cell: ({ row }) => <Badge status={row.original.priority} />,
              },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
            ]}
          />
        )}
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("tickets.new")}
      >
        <div className="stack">
          <Field label={t("tickets.title")}>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={t("nav.resources")}>
            <select
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">{t("nav.resources")}</option>
              {resources.data?.items.map((r) => (
                <option key={r.resourceUuid} value={r.resourceUuid}>
                  {dt(r.name)} · {r.displayId}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("tickets.priority")}>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {["normal", "high"].map((s) => (
                <option key={s} value={s}>
                  {t("common." + s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("tickets.message")}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          <Button
            disabled={
              !resource || title.length < 3 || message.length < 3 || busy
            }
            onClick={async () => {
              const result = await run(
                () =>
                  post<Ticket>(EP.tickets, {
                    title,
                    resourceUuid: resource,
                    priority,
                    message,
                  }),
                "success.created",
              );
              if (result) {
                setOpen(false);
                navigate("/ops/tickets/" + result.id);
              }
            }}
          >
            {t("common.create")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function TicketDetail() {
  const { id } = useParams();
  const q = useData<Ticket>(["ticket", id], `${EP.tickets}/${id}`);
  const [message, setMessage] = useState("");
  const { run, busy } = useAction();
  const role = useAuth((s) => s.role);
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const ticket = q.data;
  return (
    <>
      <PageHeader
        title={dt(ticket.title)}
        actions={<Link to="/ops/tickets">{t("common.previous")}</Link>}
      />
      <div className="stack">
        <Panel
          title={
            <span className="row">
              <Badge status={ticket.status} />
              <Badge status={ticket.priority} />
            </span>
          }
        >
          <div className="stack">
            {ticket.messages.map((m, i) => (
              <article className="notice" key={i}>
                <small>
                  {m.actor} · {date(m.at)}
                </small>
                <p style={{ marginTop: 8 }}>{dt(m.body)}</p>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title={t("tickets.reply")}>
          <div className="stack">
            <textarea
              aria-label={t("tickets.message")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={!canWrite(role)}
            />
            <div className="row">
              <Button
                disabled={!canWrite(role) || !message || busy}
                onClick={async () => {
                  await run(() => patch(`${EP.tickets}/${id}`, { message }));
                  setMessage("");
                }}
              >
                {t("tickets.reply")}
              </Button>
              <Button
                disabled={!canWrite(role) || busy}
                onClick={() =>
                  void run(() =>
                    patch(`${EP.tickets}/${id}`, {
                      status: ticket.status === "open" ? "closed" : "open",
                    }),
                  )
                }
              >
                {t("common." + (ticket.status === "open" ? "closed" : "open"))}
              </Button>
            </div>
          </div>
        </Panel>
        <Link
          to={resourceLink({
            kind: "gpu_vm",
            resourceUuid: ticket.resourceUuid,
          })}
        >
          {t("nav.resources")}
        </Link>
      </div>
    </>
  );
}
