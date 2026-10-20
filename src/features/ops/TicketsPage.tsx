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
        subtitle={t("pageDescription.tickets")}
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
  const resourceQ = useData<Resource>(
    ["ticket-resource", q.data?.resourceUuid],
    `${EP.resources}/${q.data?.resourceUuid || ""}`,
    { enabled: !!q.data },
  );
  const [message, setMessage] = useState("");
  const { run, busy } = useAction();
  const role = useAuth((s) => s.role);
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const ticket = q.data;
  const resource = resourceQ.data;
  const lastMessage = ticket.messages.at(-1);
  return (
    <>
      <PageHeader
        title={dt(ticket.title)}
        subtitle={`${t("tickets.caseId")} · ${ticket.id}`}
        actions={<Link to="/ops/tickets">{t("common.previous")}</Link>}
      />
      <div className="grid ticket-detail-layout">
        <div className="stack">
          <Panel
            title={t("tickets.correspondence")}
            hint={t("tickets.correspondenceScope")}
          >
            <div className="ticket-thread">
              {ticket.messages.map((item, index) => (
                <article className="ticket-message" key={`${item.at}-${index}`}>
                  <div className="ticket-message-marker" aria-hidden="true" />
                  <div className="ticket-message-content">
                    <div className="between">
                      <strong>{item.actor}</strong>
                      <small className="muted">{date(item.at)}</small>
                    </div>
                    <p>{dt(item.body)}</p>
                  </div>
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
                  disabled={!canWrite(role) || !message.trim() || busy}
                  onClick={async () => {
                    const result = await run(() =>
                      patch<Ticket>(`${EP.tickets}/${id}`, {
                        message: message.trim(),
                      }),
                    );
                    if (result) setMessage("");
                  }}
                >
                  {t("tickets.reply")}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
        <div className="stack">
          <Panel title={t("tickets.caseDetails")}>
            <dl className="ticket-detail-fields">
              <div>
                <dt>{t("common.status")}</dt>
                <dd>
                  <Badge status={ticket.status} />
                </dd>
              </div>
              <div>
                <dt>{t("tickets.priority")}</dt>
                <dd>
                  <Badge status={ticket.priority} />
                </dd>
              </div>
              <div>
                <dt>{t("tickets.caseId")}</dt>
                <dd className="mono">{ticket.id}</dd>
              </div>
              <div>
                <dt>{t("common.createdAt")}</dt>
                <dd>{date(ticket.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("tickets.lastActivity")}</dt>
                <dd>{date(lastMessage?.at || ticket.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("tickets.messageCount")}</dt>
                <dd>{ticket.messages.length}</dd>
              </div>
            </dl>
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
          </Panel>
          <Panel title={t("tickets.relatedResource")}>
            {resource ? (
              <div className="ticket-resource">
                <strong>{dt(resource.name)}</strong>
                <span className="mono muted">{resource.displayId}</span>
                <dl className="ticket-detail-fields">
                  <div>
                    <dt>{t("common.type")}</dt>
                    <dd>{t("common." + resource.kind)}</dd>
                  </div>
                  <div>
                    <dt>{t("common.region")}</dt>
                    <dd>{t("common." + resource.region)}</dd>
                  </div>
                  <div>
                    <dt>{t("common.status")}</dt>
                    <dd>
                      <Badge status={resource.status} />
                    </dd>
                  </div>
                </dl>
                <div className="row">
                  <Link to={resourceLink(resource)}>
                    {t("tickets.viewResource")}
                  </Link>
                  <Link to={`/ops/projects/${resource.projectId}`}>
                    {t("tickets.viewProject")}
                  </Link>
                </div>
              </div>
            ) : resourceQ.isPending ? (
              <Loading />
            ) : (
              <div className="ticket-resource">
                <span className="mono">{ticket.resourceUuid}</span>
                <small className="muted">
                  {t("tickets.resourceUnavailable")}
                </small>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
