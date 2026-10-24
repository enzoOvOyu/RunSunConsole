import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  Resource,
  Ticket,
  TicketAttachment,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "../../types/domain";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { api, EP, patch, post, query } from "../../lib/api-client";
import { formatResourceId, resourceLink } from "../../lib/ids";
import { QUOTA_TICKET_METRICS, quotaTicketMetric } from "../../lib/quota-ticket";
import { useAction, useData } from "../shared/hooks";
import { useUrlState } from "../shared/useUrlState";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { date } from "../../lib/date";
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Panel,
} from "../../components/ui";

const categories: TicketCategory[] = [
  "gpu_vm",
  "gpu_baremetal",
  "kubernetes",
  "inference",
  "image_driver",
  "network_storage",
  "billing",
  "quota_access",
  "technical",
];
const priorities: TicketPriority[] = ["low", "normal", "high", "urgent"];
const statuses: TicketStatus[] = ["open", "pending", "resolved", "closed"];
const ticketTitlePreset = (category: TicketCategory) =>
  t(`tickets.titlePreset.${category}`);
const quotaTitlePreset = (metric: string) =>
  t("tickets.quotaTitlePreset", { resource: t(`tickets.contextValue.${metric}`) });
const resourceKinds: Partial<Record<TicketCategory, Resource["kind"][]>> = {
  gpu_vm: ["gpu_vm"],
  gpu_baremetal: ["gpu_baremetal"],
  kubernetes: ["vgpu"],
  inference: ["inference"],
  image_driver: ["gpu_vm", "gpu_baremetal"],
};
const requiredResource = new Set<TicketCategory>([
  "gpu_vm",
  "gpu_baremetal",
  "kubernetes",
  "inference",
]);
type Upload = { name: string; size: number; contentType: string; content: string };
type ResourceResult = { items: Resource[] };
type TicketResult = { content: string; name: string; contentType: string };
const humanSize = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

async function readUploads(files: FileList | null): Promise<Upload[]> {
  if (!files?.length) return [];
  const selected = Array.from(files);
  if (selected.length > 5 || selected.some((file) => file.size > 5_000_000))
    throw new Error("tickets.attachmentLimit");
  return Promise.all(
    selected.map(
      (file) =>
        new Promise<Upload>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve({
                  name: file.name,
                  size: file.size,
                  contentType: file.type || "application/octet-stream",
                  content: reader.result,
                })
              : reject(new Error("tickets.attachmentReadFailed"));
          reader.onerror = () => reject(new Error("tickets.attachmentReadFailed"));
          reader.readAsDataURL(file);
        }),
    ),
  );
}
function AttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: Upload[];
  onChange: (files: Upload[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState("");
  return (
    <div className="ticket-upload">
      <label className="ticket-upload-control">
        <Paperclip size={15} aria-hidden="true" />
        {t("tickets.addAttachment")}
        <input
          type="file"
          multiple
          disabled={disabled}
          onChange={async (event: ChangeEvent<HTMLInputElement>) => {
            setError("");
            try {
              const added = await readUploads(event.target.files);
              if (files.length + added.length > 5)
                throw new Error("tickets.attachmentLimit");
              onChange([...files, ...added]);
            } catch (caught) {
              setError(caught instanceof Error ? t(caught.message) : t("error.INTERNAL"));
            }
            event.target.value = "";
          }}
        />
      </label>
      <small className="muted">{t("tickets.attachmentHelp")}</small>
      {error && <small className="field-error">{error}</small>}
      {!!files.length && (
        <ul className="ticket-upload-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name} · {humanSize(file.size)}</span>
              <button
                type="button"
                className="link-button"
                aria-label={`${t("tickets.removeAttachment")} ${file.name}`}
                onClick={() => onChange(files.filter((_, item) => item !== index))}
              >
                <XCircle size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
async function downloadAttachment(ticketId: string, attachment: TicketAttachment) {
  const result = await api<TicketResult>(
    `${EP.tickets}/${ticketId}/attachments/${attachment.id}`,
  );
  const anchor = document.createElement("a");
  anchor.href = result.content;
  anchor.download = result.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
function AttachmentLinks({ ticket, attachments }: { ticket: Ticket; attachments: TicketAttachment[] }) {
  const [error, setError] = useState("");
  return attachments.length ? (
    <div className="ticket-attachments">
      {attachments.map((attachment) => (
        <button
          type="button"
          className="ticket-attachment"
          key={attachment.id}
          onClick={async () => {
            setError("");
            try {
              await downloadAttachment(ticket.id, attachment);
            } catch {
              setError(t("tickets.attachmentUnavailable"));
            }
          }}
        >
          <Paperclip size={14} aria-hidden="true" />
          <span>{attachment.name}</span>
          <small>{humanSize(attachment.size)}</small>
          <Download size={14} aria-hidden="true" />
        </button>
      ))}
      {error && <small className="field-error">{error}</small>}
    </div>
  ) : null;
}
function statusBadge(status: TicketStatus) {
  const label = t(`tickets.status.${status}`);
  const visual = status === "closed" || status === "resolved" ? "success" : status;
  return <Badge status={visual} label={label} />;
}
function priorityBadge(priority: TicketPriority) {
  return <Badge status={priority} label={t(`tickets.priority.${priority}`)} />;
}
function resourceLabel(ticket: Ticket, resources: Resource[]) {
  const resource = resources.find((item) => item.resourceUuid === ticket.resourceUuid);
  if (resource) return `${dt(resource.name)} · ${resource.displayId}`;
  return ticket.resourceUuid || t("tickets.noResource");
}

export default function TicketsPage() {
  const region = useRegion((state) => state.region);
  const role = useAuth((state) => state.role);
  const [params, setParams] = useSearchParams();
  const quotaPreset = params.get("new") === "quota";
  const balancePreset = params.get("new") === "balance";
  const initialQuotaMetric = quotaTicketMetric(params.get("metric"));
  const [createOpen, setCreateOpen] = useState(!!params.get("new"));
  const initialCategory: TicketCategory = quotaPreset
    ? "quota_access"
    : balancePreset
      ? "billing"
      : "gpu_vm";
  const [category, setCategory] = useState<TicketCategory>(initialCategory);
  const [title, setTitle] = useState(() =>
    quotaPreset
      ? quotaTitlePreset(initialQuotaMetric)
      : balancePreset
        ? t("tickets.billingPreset")
        : ticketTitlePreset(initialCategory),
  );
  const [titleEdited, setTitleEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [resourceUuid, setResourceUuid] = useState("");
  const [context, setContext] = useState<Record<string, string>>({
    ...(quotaPreset
      ? {
          quotaMetric: initialQuotaMetric,
          ...(params.get("region") ? { region: params.get("region")! } : {}),
        }
      : {}),
  });
  const [attachments, setAttachments] = useState<Upload[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useUrlState("status");
  const [filterCategory, setFilterCategory] = useUrlState("category");
  const [filterPriority, setFilterPriority] = useUrlState("priority");
  const [search, setSearch] = useUrlState("q");
  const ticketsQuery = useData<Ticket[]>(["tickets", region], EP.tickets + query({ region }));
  const resourcesQuery = useData<ResourceResult>(
    ["ticket-resources", region],
    EP.resources + query({ region, size: 1000 }),
  );
  const { run, busy } = useAction();
  const navigate = useNavigate();
  const allResources = useMemo(() => resourcesQuery.data?.items || [], [resourcesQuery.data]);
  const eligibleResources = allResources.filter((resource) => {
    const kinds = resourceKinds[category];
    return !kinds || kinds.includes(resource.kind);
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const resourcesById = new Map(
      allResources.map((resource) => [resource.resourceUuid, resource]),
    );
    return (ticketsQuery.data || []).filter((ticket) => {
      const resource = ticket.resourceUuid
        ? resourcesById.get(ticket.resourceUuid)
        : undefined;
      return (
        (!status || ticket.status === status) &&
        (!filterCategory || ticket.category === filterCategory) &&
        (!filterPriority || ticket.priority === filterPriority) &&
        (!needle || [formatResourceId("tkt", ticket.id), ticket.title, resource?.name, resource?.displayId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)))
      );
    });
  }, [allResources, filterCategory, filterPriority, search, status, ticketsQuery.data]);
  const preview = filtered.find((ticket) => ticket.id === params.get("drawer")) || null;
  const openPreview = (ticket: Ticket) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("drawer", ticket.id);
      return next;
    }, { replace: true });
  const closePreview = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("drawer");
      return next;
    }, { replace: true });
  const openCreate = () => {
    setCategory("gpu_vm");
    setTitle(ticketTitlePreset("gpu_vm"));
    setTitleEdited(false);
    setMessage("");
    setPriority("normal");
    setResourceUuid("");
    setContext({});
    setAttachments([]);
    setAttempted(false);
    setCreateOpen(true);
  };
  const closeCreate = () => {
    setCreateOpen(false);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("new");
      next.delete("metric");
      return next;
    }, { replace: true });
  };
  const submitCreate = async () => {
    setAttempted(true);
    if (!title.trim() || title.trim().length < 3 || message.trim().length < 3) return;
    if (requiredResource.has(category) && !resourceUuid) return;
    const result = await run(
      () => post<Ticket>(EP.tickets, {
        category,
        title: title.trim(),
        message: message.trim(),
        resourceUuid: resourceUuid || null,
        region: category === "quota_access" ? context.region || region : region,
        priority,
        context,
        attachments,
      }),
      "success.created",
    );
    if (!result) return;
    setCreateOpen(false);
    setAttempted(false);
    setAttachments([]);
    navigate(`/ops/tickets/${result.id}`);
  };
  const columns: ColumnDef<Ticket>[] = [
    {
      accessorKey: "caseNumber",
      header: t("tickets.caseId"),
      cell: ({ row }) => <span className="ticket-case-id">{formatResourceId("tkt", row.original.id)}</span>,
    },
    {
      accessorKey: "title",
      header: t("tickets.title"),
      cell: ({ row }) => <span className="ticket-table-title-text">{dt(row.original.title)}</span>,
    },
    {
      accessorKey: "resourceUuid",
      header: t("tickets.relatedResource"),
      cell: ({ row }) => {
        const resource = allResources.find((item) => item.resourceUuid === row.original.resourceUuid);
        return resource ? (
          <Link to={resourceLink(resource)} onClick={(event) => event.stopPropagation()}>
            {dt(resource.name)} · <span className="mono">{resource.displayId}</span>
          </Link>
        ) : resourceLabel(row.original, allResources);
      },
    },
    {
      accessorKey: "category",
      header: t("tickets.category"),
      cell: ({ row }) => t(`tickets.category.${row.original.category}`),
    },
    {
      accessorKey: "priority",
      header: t("tickets.priority"),
      cell: ({ row }) => priorityBadge(row.original.priority),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => statusBadge(row.original.status),
    },
    {
      accessorKey: "createdAt",
      header: t("common.createdAt"),
      cell: ({ row }) => date(row.original.createdAt),
    },
    {
      accessorKey: "updatedAt",
      header: t("tickets.updatedAt"),
      cell: ({ row }) => date(row.original.updatedAt || row.original.createdAt),
    },
    {
      id: "detail",
      header: "",
      cell: () => <ChevronRight size={16} className="muted" aria-hidden="true" />,
    },
  ];
  return (
    <div className="ticket-page">
      <PageHeader
        title={t("nav.tickets")}
        subtitle={t("pageDescription.tickets")}
        actions={
          <Button variant="primary" disabled={!canWrite(role)} onClick={openCreate}>
            <Plus size={16} /> {t("tickets.new")}
          </Button>
        }
      />
      <div className="toolbar ticket-toolbar">
        <RegionFilter />
        <input
          className="input search"
          placeholder={t("tickets.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select aria-label={t("common.status")} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t("tickets.allStatuses")}</option>
          {statuses.map((value) => <option key={value} value={value}>{t(`tickets.status.${value}`)}</option>)}
        </select>
        <select aria-label={t("tickets.category")} value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>
          <option value="">{t("tickets.allCategories")}</option>
          {categories.map((value) => <option key={value} value={value}>{t(`tickets.category.${value}`)}</option>)}
        </select>
        <select aria-label={t("tickets.priority")} value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
          <option value="">{t("tickets.allPriorities")}</option>
          {priorities.map((value) => <option key={value} value={value}>{t(`tickets.priority.${value}`)}</option>)}
        </select>
      </div>
      <div className="panel">
        {ticketsQuery.isPending ? <Loading /> : ticketsQuery.error ? <ErrorState error={ticketsQuery.error} retry={() => void ticketsQuery.refetch()} /> : (
          <DataTable
            data={filtered}
            columns={columns}
            onRow={openPreview}
            empty={t("tickets.empty")}
          />
        )}
      </div>
      <Modal open={createOpen} onClose={closeCreate} title={t("tickets.new")} description={t("tickets.createHint")}>
        <div className="stack ticket-create-form">
          <div className="grid ticket-form-grid">
            <Field label={t("tickets.category")}>
              <select
                value={category}
                onChange={(event) => {
                  const next = event.target.value as TicketCategory;
                  setCategory(next);
                  setTitle(next === "quota_access" ? quotaTitlePreset("gpu") : ticketTitlePreset(next));
                  setTitleEdited(false);
                  setResourceUuid("");
                  setContext(next === "quota_access" ? { quotaMetric: "gpu" } : {});
                }}
              >
                {categories.map((value) => <option key={value} value={value}>{t(`tickets.category.${value}`)}</option>)}
              </select>
            </Field>
            <Field label={t("tickets.priority")}>
              <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
                {priorities.map((value) => <option key={value} value={value}>{t(`tickets.priority.${value}`)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("tickets.title")} error={attempted && title.trim().length < 3 ? t("tickets.titleRequired") : undefined}>
            <input
              className="input"
              maxLength={120}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleEdited(true);
              }}
              aria-invalid={attempted && title.trim().length < 3}
            />
          </Field>
          {requiredResource.has(category) || category === "image_driver" || category === "network_storage" ? (
            <Field label={t("tickets.relatedResource")} hint={requiredResource.has(category) ? t("tickets.resourceRequired") : t("tickets.resourceOptional")} error={attempted && requiredResource.has(category) && !resourceUuid ? t("tickets.resourceRequired") : undefined}>
              <select value={resourceUuid} onChange={(event) => setResourceUuid(event.target.value)}>
                <option value="">{t("tickets.selectResource")}</option>
                {eligibleResources.map((resource) => <option key={resource.resourceUuid} value={resource.resourceUuid}>{dt(resource.name)} · {resource.displayId} · {t(`common.${resource.kind}`)}</option>)}
              </select>
            </Field>
          ) : null}
          {category === "billing" && (
            <div className="grid ticket-form-grid">
              <Field label={t("tickets.billingPeriod")}>
                <input className="input" type="month" value={context.billingPeriod || ""} onChange={(event) => setContext({ ...context, billingPeriod: event.target.value })} />
              </Field>
              <Field label={t("tickets.invoiceNumber")}>
                <input className="input" value={context.invoiceNumber || ""} onChange={(event) => setContext({ ...context, invoiceNumber: event.target.value })} />
              </Field>
            </div>
          )}
          {category === "quota_access" && (
            <div className="grid ticket-form-grid">
              <Field label={t("tickets.quotaRegion")}>
                <select value={context.region || region} onChange={(event) => setContext({ ...context, region: event.target.value })}>
                  {["jp", "sg", "us"].map((value) => <option key={value} value={value}>{t(`common.${value}`)}</option>)}
                </select>
              </Field>
              <Field label={t("tickets.quotaMetric")}>
                <select value={context.quotaMetric || "gpu"} onChange={(event) => {
                  const metric = quotaTicketMetric(event.target.value);
                  setContext({ ...context, quotaMetric: metric });
                  if (!titleEdited) setTitle(quotaTitlePreset(metric));
                }}>
                  {QUOTA_TICKET_METRICS.map((value) => <option key={value} value={value}>{t(`tickets.contextValue.${value}`)}</option>)}
                </select>
              </Field>
            </div>
          )}
          {category === "network_storage" && (
            <Field label={t("tickets.affectedService")}>
              <select value={context.affectedService || "vpc"} onChange={(event) => setContext({ ...context, affectedService: event.target.value })}>
                {["vpc", "eip", "security_group", "tunnel", "block_storage", "file_storage", "object_storage"].map((value) => <option key={value} value={value}>{t(`tickets.service.${value}`)}</option>)}
              </select>
            </Field>
          )}
          {category === "image_driver" && (
            <Field label={t("tickets.imageComponent")}>
              <select value={context.imageComponent || "driver"} onChange={(event) => setContext({ ...context, imageComponent: event.target.value })}>
                {["image", "driver", "cuda", "framework"].map((value) => <option key={value} value={value}>{t(`tickets.image.${value}`)}</option>)}
              </select>
            </Field>
          )}
          {category === "technical" && (
            <Field label={t("tickets.consultTopic")}>
              <select value={context.topic || "deployment"} onChange={(event) => setContext({ ...context, topic: event.target.value })}>
                {["deployment", "performance", "api", "other"].map((value) => <option key={value} value={value}>{t(`tickets.topic.${value}`)}</option>)}
              </select>
            </Field>
          )}
          <Field label={t("tickets.message")} error={attempted && message.trim().length < 3 ? t("tickets.messageRequired") : undefined}>
            <textarea rows={6} maxLength={10000} value={message} onChange={(event) => setMessage(event.target.value)} aria-invalid={attempted && message.trim().length < 3} />
          </Field>
          <AttachmentPicker files={attachments} onChange={setAttachments} disabled={busy} />
          <div className="row ticket-form-actions">
            <Button variant="default" onClick={closeCreate}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!canWrite(role) || busy} onClick={() => void submitCreate()}>
              <Plus size={15} /> {t("tickets.submit")}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={!!preview}
        onClose={closePreview}
        drawer
        small
        title={preview ? <span className="row"><span className="ticket-case-id">{formatResourceId("tkt", preview.id)}</span> {statusBadge(preview.status)}</span> : t("tickets.caseDetails")}
        description={preview ? dt(preview.title) : undefined}
      >
        {preview && <div className="stack">
          <dl className="ticket-detail-fields">
            <div><dt>{t("tickets.category")}</dt><dd>{t(`tickets.category.${preview.category}`)}</dd></div>
            <div><dt>{t("tickets.priority")}</dt><dd>{priorityBadge(preview.priority)}</dd></div>
            <div><dt>{t("tickets.relatedResource")}</dt><dd>{resourceLabel(preview, allResources)}</dd></div>
            <div><dt>{t("tickets.createdAt")}</dt><dd>{date(preview.createdAt)}</dd></div>
            <div><dt>{t("tickets.updatedAt")}</dt><dd>{date(preview.updatedAt || preview.createdAt)}</dd></div>
            <div><dt>{t("tickets.messageCount")}</dt><dd>{preview.messages.length}</dd></div>
          </dl>
          <Panel title={t("tickets.latestUpdate")}>
            <p className="ticket-preview-message">{dt(preview.messages.at(-1)?.body || "—")}</p>
          </Panel>
          <div className="row ticket-form-actions">
            <Button variant="default" onClick={closePreview}>{t("common.close")}</Button>
            <Button variant="primary" onClick={() => navigate(`/ops/tickets/${preview.id}`)}>
              <ExternalLink size={15} /> {t("tickets.viewDetails")}
            </Button>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

export function TicketDetail() {
  const { id = "" } = useParams();
  const q = useData<Ticket>(["ticket", id], `${EP.tickets}/${id}`, { poll: true });
  const ticket = q.data;
  const resourceQuery = useData<Resource>(
    ["ticket-resource", ticket?.resourceUuid],
    `${EP.resources}/${ticket?.resourceUuid || ""}`,
    { enabled: !!ticket?.resourceUuid },
  );
  const [message, setMessage] = useState("");
  const [resolution, setResolution] = useState("");
  const [attachments, setAttachments] = useState<Upload[]>([]);
  const [showResolution, setShowResolution] = useState(false);
  const [formError, setFormError] = useState("");
  const { run, busy } = useAction();
  const role = useAuth((state) => state.role);
  if (q.isPending) return <Loading />;
  if (q.error || !ticket) return <ErrorState error={q.error || new Error("NOT_FOUND")} retry={() => void q.refetch()} />;
  const resource = resourceQuery.data;
  const isClosed = ticket.status === "closed";
  const submitReply = async () => {
    setFormError("");
    if (message.trim().length < 3) {
      setFormError(t("tickets.messageRequired"));
      return;
    }
    const result = await run(() => patch<Ticket>(`${EP.tickets}/${id}`, {
      message: message.trim(),
      attachments,
    }));
    if (result) {
      setMessage("");
      setAttachments([]);
    }
  };
  const setTicketStatus = async (next: TicketStatus) => {
    setFormError("");
    if (next === "resolved" && resolution.trim().length < 3) {
      setShowResolution(true);
      setFormError(t("tickets.resolutionRequired"));
      return;
    }
    const result = await run(() => patch<Ticket>(`${EP.tickets}/${id}`, {
      status: next,
      ...(next === "resolved" ? { resolution: resolution.trim() } : {}),
    }));
    if (result) {
      setShowResolution(false);
      setResolution("");
    }
  };
  return (
    <div className="ticket-page">
      <PageHeader
        title={<span className="ticket-detail-title">{dt(ticket.title)}</span>}
        subtitle={`${formatResourceId("tkt", ticket.id)} · ${t(`tickets.category.${ticket.category}`)}`}
        actions={<Link to="/ops/tickets">{t("tickets.backToList")}</Link>}
      />
      <div className="grid ticket-detail-layout">
        <div className="stack">
          <Panel title={t("tickets.progress")}>
            <ol className="ticket-timeline">
              {(ticket.events || []).map((event) => (
                <li key={event.id}>
                  <span className={`ticket-timeline-marker ${event.type}`} aria-hidden="true" />
                  <div>
                    <div className="between"><strong>{t(event.summary) === event.summary ? dt(event.summary) : t(event.summary)}</strong><small className="muted">{date(event.at)}</small></div>
                    <small>{dt(event.actor)} · {t(`tickets.status.${event.status}`)}</small>
                  </div>
                </li>
              ))}
            </ol>
            {ticket.status === "resolved" && ticket.resolution && (
              <div className="ticket-resolution"><strong>{t("tickets.resolution")}</strong><p>{dt(ticket.resolution)}</p></div>
            )}
          </Panel>
          <Panel title={t("tickets.correspondence")} hint={t("tickets.correspondenceScope")}>
            <div className="ticket-thread">
              {ticket.messages.map((item, index) => (
                <article className="ticket-message" key={`${item.at}-${index}`}>
                  <div className="ticket-message-marker" aria-hidden="true" />
                  <div className="ticket-message-content">
                    <div className="between"><strong>{dt(item.actor)}</strong><small className="muted">{date(item.at)}</small></div>
                    <p>{dt(item.body)}</p>
                    <AttachmentLinks ticket={ticket} attachments={item.attachments || []} />
                  </div>
                </article>
              ))}
            </div>
          </Panel>
          {!isClosed && (
            <Panel title={t("tickets.reply")}>
              <div className="stack">
                <textarea rows={5} aria-label={t("tickets.message")} value={message} maxLength={10000} onChange={(event) => setMessage(event.target.value)} />
                <AttachmentPicker files={attachments} onChange={setAttachments} disabled={busy} />
                {formError && <div role="alert" className="field-error">{formError}</div>}
                <div className="row ticket-form-actions">
                  {ticket.status !== "resolved" && <Button variant="default" disabled={busy} onClick={() => void setTicketStatus("pending")}>{t("tickets.awaitingCustomer")}</Button>}
                  <Button variant="primary" disabled={!canWrite(role) || busy || message.trim().length < 3} onClick={() => void submitReply()}><Send size={15} /> {t("tickets.reply")}</Button>
                </div>
              </div>
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title={t("tickets.caseDetails")}>
            <div className="ticket-status-summary">
              {statusBadge(ticket.status)}
              {priorityBadge(ticket.priority)}
            </div>
            <dl className="ticket-detail-fields">
              <div><dt>{t("tickets.caseId")}</dt><dd className="ticket-case-id">{formatResourceId("tkt", ticket.id)}</dd></div>
              <div><dt>{t("tickets.category")}</dt><dd>{t(`tickets.category.${ticket.category}`)}</dd></div>
              <div><dt>{t("tickets.createdAt")}</dt><dd>{date(ticket.createdAt)}</dd></div>
              <div><dt>{t("tickets.updatedAt")}</dt><dd>{date(ticket.updatedAt || ticket.createdAt)}</dd></div>
              <div><dt>{t("tickets.messageCount")}</dt><dd>{ticket.messages.length}</dd></div>
              {ticket.region && <div><dt>{t("common.region")}</dt><dd>{t(`common.${ticket.region}`)}</dd></div>}
            </dl>
            <div className="stack ticket-status-actions">
              {ticket.status === "resolved" && <Button variant="default" disabled={!canWrite(role) || busy} onClick={() => void setTicketStatus("closed")}><CheckCircle2 size={15} /> {t("tickets.closeTicket")}</Button>}
              {(ticket.status === "open" || ticket.status === "pending") && <>
                <Button variant="default" disabled={!canWrite(role) || busy} onClick={() => setShowResolution((value) => !value)}><CheckCircle2 size={15} /> {t("tickets.markResolved")}</Button>
                {showResolution && <div className="stack">
                  <Field label={t("tickets.resolution")} error={formError || undefined}><textarea rows={4} value={resolution} maxLength={2000} onChange={(event) => setResolution(event.target.value)} /></Field>
                  <Button variant="primary" disabled={!canWrite(role) || busy} onClick={() => void setTicketStatus("resolved")}>{t("tickets.saveResolution")}</Button>
                </div>}
              </>}
              {ticket.status === "closed" && <Button variant="default" disabled={!canWrite(role) || busy} onClick={() => void setTicketStatus("open")}><RotateCcw size={15} /> {t("tickets.reopen")}</Button>}
              {ticket.status !== "closed" && <Button variant="ghost" disabled={!canWrite(role) || busy} onClick={() => void setTicketStatus("closed")}><XCircle size={15} /> {t("tickets.closeTicket")}</Button>}
            </div>
          </Panel>
          <Panel title={t("tickets.relatedResource")}>
            {resource ? (
              <div className="ticket-resource">
                <strong>{dt(resource.name)}</strong>
                <span className="mono muted">{resource.displayId}</span>
                <dl className="ticket-detail-fields">
                  <div><dt>{t("common.type")}</dt><dd>{t(`common.${resource.kind}`)}</dd></div>
                  <div><dt>{t("common.region")}</dt><dd>{t(`common.${resource.region}`)}</dd></div>
                  <div><dt>{t("common.status")}</dt><dd><Badge status={resource.status} /></dd></div>
                </dl>
                <div className="row"><Link to={resourceLink(resource)}>{t("tickets.viewResource")}</Link><Link to={`/ops/projects/${resource.projectId}`}>{t("tickets.viewProject")}</Link></div>
              </div>
            ) : ticket.resourceUuid ? resourceQuery.isPending ? <Loading /> : <div className="ticket-resource"><span className="resource-id">{formatResourceId("res", ticket.resourceUuid)}</span><small className="muted">{t("tickets.resourceUnavailable")}</small></div> : <p className="muted">{t("tickets.noResource")}</p>}
          </Panel>
          {Object.keys(ticket.context || {}).length > 0 && (
            <Panel title={t("tickets.requestContext")}>
              <dl className="ticket-detail-fields">
                {Object.entries(ticket.context).map(([key, value]) => {
                  const labelKey = key === "affectedService"
                    ? `tickets.service.${value}`
                    : key === "imageComponent"
                      ? `tickets.image.${value}`
                      : key === "topic"
                        ? `tickets.topic.${value}`
                        : key === "region"
                          ? `common.${value}`
                          : key === "quotaMetric"
                            ? `tickets.contextValue.${value}`
                            : "";
                  const translated = labelKey ? t(labelKey) : value;
                  return <div key={key}><dt>{t(`tickets.context.${key}`)}</dt><dd>{translated === labelKey ? dt(value) : translated}</dd></div>;
                })}
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
