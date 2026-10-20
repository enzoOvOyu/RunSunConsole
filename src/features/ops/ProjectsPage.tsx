import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState, lazy, Suspense } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Folder, Plus } from "lucide-react";
import {
  KINDS,
  REGIONS,
  ROLES,
  type Project,
  type Resource,
  type Quota,
  type Role,
} from "../../types/domain";
import { useAuth } from "../../stores/auth";
import { canWrite, canManageOrg } from "../../lib/rbac";
import { EP, post, patch, remove } from "../../lib/api-client";
import { KIND_META, resourceLink } from "../../lib/ids";
import { date } from "../../lib/date";
import { useAction, useData } from "../shared/hooks";
import { t, dt } from "../../i18n";
import { money, number } from "../../lib/money";
import {
  PageHeader,
  Button,
  Panel,
  Modal,
  Field,
  Empty,
  Loading,
  ErrorState,
  Tabs,
  Badge,
  DataTable,
  Progress,
} from "../../components/ui";
import { RegionFilter } from "../shared/RegionFilter";
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
interface ProjectSummary extends Project {
  gpuTotal: number;
  monthCost: number;
  resourceItems: Resource[];
  quotas: Quota[];
  myRole: Role;
  costTrend7d: Record<string, unknown>[];
}
export default function ProjectsPage() {
  const q = useData<Project[]>(["projects"], EP.projects);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useUrlState("q");
  const { run, busy } = useAction();
  const role = useAuth((s) => s.role);
  return (
    <>
      <PageHeader
        title={t("nav.projects")}
        subtitle={t("project.description")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setNewOpen(true)}
          >
            <Plus size={14} />
            {t("common.create")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter org />
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data?.length ? (
        <div className="stack">
          {q.data
            .filter((p) =>
              dt(p.name).toLowerCase().includes(search.toLowerCase()),
            )
            .map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
        </div>
      ) : (
        <Empty />
      )}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={t("wizard.projectNew")}
      >
        <div className="stack">
          <Field label={t("project.name")}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            disabled={name.length < 2 || busy}
            onClick={async () => {
              const result = await run(
                () => post<Project>(EP.projects, { name }),
                "success.created",
              );
              if (result) {
                setNewOpen(false);
                setName("");
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
function ProjectCard({ project: p }: { project: Project }) {
  const q = useData<ProjectSummary>(
    ["project-summary", p.id],
    `${EP.projects}/${p.id}/summary`,
  );
  const navigate = useNavigate();
  return (
    <article className="panel project-row">
      <div className="row">
        <Folder size={24} color="var(--rs-brand)" />
        <div>
          <strong>{dt(p.name)}</strong>
          <div>
            <small className="mono">{p.slug}</small>{" "}
            {p.isDefault && (
              <span className="chip">{t("project.default")}</span>
            )}
          </div>
        </div>
      </div>
      <div>
        <small>{t("overview.allocated")}</small>
        <div>
          <strong>{q.data ? number(q.data.gpuTotal) : "—"}</strong>
        </div>
      </div>
      <div>
        <small>{t("common.mtd")}</small>
        <div>{q.data ? money(q.data.monthCost) : "—"}</div>
      </div>
      <div>
        <small>
          {t("project.members")} · {p.members.length} / {t("project.myRole")} ·{" "}
          {t("common." + (q.data?.myRole || "owner"))}
        </small>
        <div className="row">
          {q.data?.resourceItems.length} {t("nav.resources")}
        </div>
      </div>
      <Button onClick={() => navigate("/ops/projects/" + p.id)}>
        {t("common.details")}
      </Button>
    </article>
  );
}
export function ProjectDetail() {
  const { projectUuid } = useParams();
  const q = useData<ProjectSummary>(
    ["project-summary", projectUuid],
    `${EP.projects}/${projectUuid}/summary`,
  );
  const [tab, setTab] = useState("overview");
  const [member, setMember] = useState("");
  const [name, setName] = useState("");
  const role = useAuth((s) => s.role);
  const { run, busy } = useAction();
  const navigate = useNavigate();
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const p = q.data;
  const resourceMix = KINDS.map((kind) => {
    const items = p.resourceItems.filter((resource) => resource.kind === kind);
    return {
      kind,
      total: items.length,
      running: items.filter((resource) => resource.status === "running").length,
      gpuCount: items.reduce(
        (sum, resource) => sum + resource.spec.gpuCount,
        0,
      ),
    };
  });
  const regionalMix = REGIONS.map((region) => {
    const items = p.resourceItems.filter(
      (resource) => resource.region === region,
    );
    return {
      region,
      total: items.length,
      gpuCount: items.reduce(
        (sum, resource) => sum + resource.spec.gpuCount,
        0,
      ),
    };
  });
  return (
    <>
      <PageHeader
        title={dt(p.name)}
        subtitle={p.slug}
        actions={
          <Button onClick={() => navigate("/ops/projects")}>
            {t("common.previous")}
          </Button>
        }
      />
      <Tabs
        items={[
          "overview",
          "resources",
          "members",
          "quotas",
          "cost",
          "settings",
        ].map((id) => ({
          id,
          label: t(
            id === "overview"
              ? "tab.overview"
              : id === "settings"
                ? "project.settings"
                : id === "members"
                  ? "project.members"
                  : `nav.${id}`,
          ),
        }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "overview" ? (
        <div className="stack">
          <div className="grid project-detail-stats">
            {[
              [t("overview.allocated"), number(p.gpuTotal)],
              [t("common.mtd"), money(p.monthCost)],
              [t("project.resources"), number(p.resourceItems.length)],
              [t("project.members"), number(p.members.length)],
            ].map(([label, value]) => (
              <Panel title={label} key={label}>
                <strong className="stat-value">{value}</strong>
              </Panel>
            ))}
          </div>
          <div className="grid grid-2 project-detail-grid">
            <Panel title={t("project.resourceMix")}>
              <div className="project-detail-table">
                <div className="project-detail-table-head">
                  <span>{t("common.type")}</span>
                  <span>{t("project.runningTotal")}</span>
                  <span>GPU</span>
                </div>
                {resourceMix.map((item) => {
                  const Icon = KIND_META[item.kind].icon;
                  return (
                    <div className="project-detail-table-row" key={item.kind}>
                      <span className="row">
                        <Icon
                          size={16}
                          style={{ color: KIND_META[item.kind].color }}
                        />
                        {t("common." + item.kind)}
                      </span>
                      <span className="mono">
                        {number(item.running)} / {number(item.total)}
                      </span>
                      <strong className="mono">{number(item.gpuCount)}</strong>
                    </div>
                  );
                })}
              </div>
              <h3 className="project-region-heading">
                {t("project.regionalMix")}
              </h3>
              <div className="grid grid-3 project-regions">
                {regionalMix.map((item) => (
                  <div key={item.region}>
                    <small className="muted">
                      {t("common." + item.region)}
                    </small>
                    <strong className="mono">
                      {number(item.gpuCount)} GPU
                    </strong>
                    <small>
                      {t("project.resourceCount", {
                        count: number(item.total),
                      })}
                    </small>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={t("project.profile")}>
              <dl className="project-detail-profile">
                {[
                  [t("project.slug"), p.slug],
                  [t("project.defaultRegion"), t("common." + p.defaultRegion)],
                  [t("common.createdAt"), date(p.createdAt)],
                  [t("project.myRole"), t("common." + p.myRole)],
                  [
                    t("project.labels"),
                    p.labels.length ? p.labels.join(", ") : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {p.isDefault && (
                <span className="chip">{t("project.default")}</span>
              )}
            </Panel>
          </div>
        </div>
      ) : tab === "resources" ? (
        <Panel title={t("project.resources")}>
          <DataTable
            data={p.resourceItems}
            onRow={(r) => navigate(resourceLink(r))}
            columns={[
              {
                accessorKey: "name",
                header: t("common.name"),
                cell: ({ row }) => dt(row.original.name),
              },
              { accessorKey: "displayId", header: "ID" },
              {
                accessorKey: "region",
                header: t("common.region"),
                cell: ({ row }) => t("common." + row.original.region),
              },
              {
                accessorKey: "gpuCount",
                header: "GPU",
                cell: ({ row }) => number(row.original.spec.gpuCount),
              },
              {
                accessorKey: "kind",
                header: t("common.type"),
                cell: ({ row }) => t("common." + row.original.kind),
              },
              {
                accessorKey: "status",
                header: t("common.status"),
                cell: ({ row }) => <Badge status={row.original.status} />,
              },
            ]}
          />
        </Panel>
      ) : tab === "members" ? (
        <Panel title={t("project.members")}>
          <div className="stack">
            {p.members.map((m) => (
              <div className="between" key={m.userId}>
                <span>{m.name}</span>
                <div className="row">
                  <select
                    aria-label={t("header.role")}
                    value={m.role}
                    disabled={!canManageOrg(role)}
                    onChange={(e) =>
                      void run(() =>
                        patch(`${EP.projects}/${p.id}/members`, {
                          members: p.members.map((v) =>
                            v.userId === m.userId
                              ? { ...v, role: e.target.value }
                              : v,
                          ),
                        }),
                      )
                    }
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {t("common." + role)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="danger"
                    disabled={!canManageOrg(role) || m.role === "owner"}
                    onClick={() =>
                      void run(() =>
                        patch(`${EP.projects}/${p.id}/members`, {
                          members: p.members.filter(
                            (x) => x.userId !== m.userId,
                          ),
                        }),
                      )
                    }
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            <div className="row">
              <input
                className="input"
                value={member}
                onChange={(e) => setMember(e.target.value)}
                placeholder={t("project.members")}
              />
              <Button
                disabled={!canManageOrg(role) || !member}
                onClick={async () => {
                  const result = await run(() =>
                    patch(`${EP.projects}/${p.id}/members`, {
                      members: [
                        ...p.members,
                        { userId: member, name: member, role: "member" },
                      ],
                    }),
                  );
                  if (result) setMember("");
                }}
              >
                {t("common.create")}
              </Button>
            </div>
          </div>
        </Panel>
      ) : tab === "quotas" ? (
        <Panel
          title={t("project.sharedQuotas")}
          hint={t("project.sharedQuotasScope")}
        >
          <div className="grid grid-3">
            {REGIONS.map((region) => (
              <div key={region}>
                <h3>{t("common." + region)}</h3>
                {p.quotas
                  .filter((q) => q.region === region)
                  .flatMap((quota) =>
                    quota.metric === "storage"
                      ? (quota.storageBreakdown || []).map((storage) => (
                          <div className="quota-line" key={storage.kind}>
                            <div className="between">
                              <small>
                                {t("quota.storage." + storage.kind)}
                              </small>
                              <small className="mono">
                                {number(storage.usedGb / 1000)} /{" "}
                                {number(storage.limitGb / 1000)} TB
                              </small>
                            </div>
                            <Progress
                              value={(storage.usedGb / storage.limitGb) * 100}
                            />
                          </div>
                        ))
                      : [
                          <div className="quota-line" key={quota.metric}>
                            <div className="between">
                              <small>{t("quota." + quota.metric)}</small>
                              <small className="mono">
                                {number(quota.usedValue)} /{" "}
                                {number(quota.limitValue)}
                              </small>
                            </div>
                            <Progress
                              value={(quota.usedValue / quota.limitValue) * 100}
                            />
                          </div>,
                        ],
                  )}
              </div>
            ))}
          </div>
        </Panel>
      ) : tab === "cost" ? (
        <div className="stack">
          <Panel title={t("common.mtd")}>
            <strong className="stat-value">{money(p.monthCost)}</strong>
          </Panel>
          <Panel title={t("overview.trend")} hint={t("project.costTrendScope")}>
            <Suspense fallback={<Loading />}>
              <TrendChart data={p.costTrend7d} />
            </Suspense>
          </Panel>
        </div>
      ) : (
        <Panel title={t("project.settings")}>
          <div className="stack">
            <Field label={t("project.name")}>
              <input
                className="input"
                value={name || p.name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Button
              disabled={
                !canManageOrg(role) || !!p.deletedAt || busy || name.length < 2
              }
              onClick={() =>
                void run(() => patch(`${EP.projects}/${p.id}`, { name }))
              }
            >
              {t("common.save")}
            </Button>
            <Field label={t("common.region")}>
              <select
                value={p.defaultRegion}
                disabled={!canManageOrg(role)}
                onChange={(e) =>
                  void run(() =>
                    patch(`${EP.projects}/${p.id}`, {
                      defaultRegion: e.target.value,
                    }),
                  )
                }
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {t("common." + r)}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="danger"
              disabled={!canManageOrg(role) || !!p.deletedAt || p.isDefault}
              onClick={async () => {
                if (
                  !(await confirmAction(t("common.delete") + " " + dt(p.name)))
                )
                  return;
                try {
                  await remove(`${EP.projects}/${p.id}`);
                  navigate("/ops/projects");
                } catch {
                  await run(() => remove(`${EP.projects}/${p.id}`));
                }
              }}
            >
              {t("common.delete")}
            </Button>
            <Link to="/ops/projects">{t("nav.projects")}</Link>
          </div>
        </Panel>
      )}
    </>
  );
}
