import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState, lazy, Suspense } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Folder, Plus } from "lucide-react";
import {
  KINDS,
  REGIONS,
  ROLES,
  type Project,
  type Resource,
  type Quota,
  type Role,
  type Region,
} from "../../types/domain";
import { useAuth } from "../../stores/auth";
import { useRegion } from "../../stores/region";
import { canWrite, canManageOrg } from "../../lib/rbac";
import { EP, post, patch, remove } from "../../lib/api-client";
import { KIND_META, formatResourceId, resourceLink } from "../../lib/ids";
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
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
interface ProjectSummary extends Project {
  gpuTotal: number;
  monthCost: number;
  resourceItems: Resource[];
  quotas: Quota[];
  myRole: Role;
  costTrendMonth: Record<string, unknown>[];
}
export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const region = useRegion((state) => state.region);
  const selectedRegion = params.get("region");
  const q = useData<Project[]>(["projects"], EP.projects);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectRegion, setProjectRegion] = useState<Region>(region);
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
            onClick={() => {
              setProjectRegion(region);
              setNewOpen(true);
            }}
          >
            <Plus size={14} />
            {t("common.create")}
          </Button>
        }
      />
      <div className="toolbar">
        <select aria-label={t("common.region")} value={REGIONS.includes(selectedRegion as Region) ? selectedRegion! : "all"}
          onChange={(event) => setParams((current) => { const next = new URLSearchParams(current); if (event.target.value === "all") next.delete("region"); else next.set("region", event.target.value); return next; }, { replace: true })}>
          <option value="all">{t("common.allRegions")}</option>
          {REGIONS.map((value) => <option key={value} value={value}>{t("common." + value)}</option>)}
        </select>
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
            .filter((p) => !REGIONS.includes(selectedRegion as Region) || p.defaultRegion === selectedRegion)
            .filter((p) =>
              [dt(p.name), formatResourceId("prj", p.id)].some((value) =>
                value.toLowerCase().includes(search.toLowerCase()),
              ),
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
          <Field label={t("project.defaultRegion")}>
            <select
              value={projectRegion}
              onChange={(e) => setProjectRegion(e.target.value as Region)}
            >
              {REGIONS.map((availableRegion) => (
                <option key={availableRegion} value={availableRegion}>
                  {t("common." + availableRegion)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={name.length < 2 || busy}
            onClick={async () => {
              const result = await run(
                () =>
                  post<Project>(EP.projects, {
                    name,
                    defaultRegion: projectRegion,
                  }),
                "success.created",
              );
              if (result) {
                if (REGIONS.includes(selectedRegion as Region) && selectedRegion !== projectRegion) {
                  const next = new URLSearchParams(params);
                  next.delete("region");
                  setParams(next, { replace: true });
                }
                setNewOpen(false);
                setName("");
                setProjectRegion(projectRegion);
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
const isAllocatedResource = (resource: Resource) =>
  resource.status === "running" || resource.status === "provisioning";

function allocatedGpuCount(resource: Resource) {
  return isAllocatedResource(resource) ? resource.spec.gpuCount : 0;
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
            <small>{t("project.id")}: </small>
            <small className="resource-id">{formatResourceId("prj", p.id)}</small>
          </div>
          <small>{t("common." + p.defaultRegion)}</small>
          {p.isDefault && (
            <span className="chip">{t("project.default")}</span>
          )}
        </div>
      </div>
      <div>
        <small>{t("overview.allocated")}</small>
        <div>
          <strong>{q.data ? number(q.data.gpuTotal) : "—"}</strong>
        </div>
      </div>
      <div>
        <small>
          {t("common.mtd")} · {t("common." + p.defaultRegion)}
        </small>
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
        (sum, resource) => sum + allocatedGpuCount(resource),
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
        (sum, resource) => sum + allocatedGpuCount(resource),
        0,
      ),
    };
  });
  return (
    <>
      <PageHeader
        title={dt(p.name)}
        actions={
          <Button onClick={() => navigate("/ops/projects")}>
            {t("common.previous")}
          </Button>
        }
      />
      <div className="project-detail-tabbar">
        <Tabs
          className="tall-tabs"
          items={["overview", "resources", "members", "quotas", "cost"].map((id) => ({
            id,
            label: t(
              id === "overview"
                ? "tab.overview"
                : id === "members"
                  ? "project.members"
                  : `nav.${id}`,
            ),
          }))}
          value={tab}
          onChange={setTab}
        />
        <Button
          variant="danger"
          disabled={!canManageOrg(role) || !!p.deletedAt || p.isDefault || busy}
          onClick={async () => {
            if (!(await confirmAction(t("common.delete") + " " + dt(p.name), formatResourceId("prj", p.id)))) return;
            const deleted = await run(async () => {
              await remove(`${EP.projects}/${p.id}`);
              return true;
            }, "success.deleted");
            if (deleted) navigate("/ops/projects");
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
      {tab === "overview" ? (
        <div className="stack">
          <div className="grid project-detail-stats">
            {[
              [t("overview.allocated"), number(p.gpuTotal)],
              [
                `${t("common.mtd")} · ${t("common." + p.defaultRegion)}`,
                money(p.monthCost),
              ],
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
                  [t("project.id"), formatResourceId("prj", p.id)],
                  [t("project.defaultRegion"), t("common." + p.defaultRegion)],
                  [t("common.createdAt"), date(p.createdAt)],
                  [t("project.myRole"), t("common." + p.myRole)],
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
              <div className="stack" style={{ marginTop: 16 }}>
                <Field label={t("project.name")}>
                  <input
                    className="input"
                    value={name || p.name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={!canManageOrg(role) || !!p.deletedAt}
                  />
                </Field>
                <Button
                  disabled={
                    !canManageOrg(role) || !!p.deletedAt || busy ||
                    (name.trim() || p.name).length < 2 ||
                    (name.trim() || p.name) === p.name
                  }
                  onClick={async () => {
                    const nextName = name.trim() || p.name;
                    const saved = await run(() => patch(`${EP.projects}/${p.id}`, { name: nextName }));
                    if (saved) setName(nextName);
                  }}
                >
                  {t("common.save")}
                </Button>
              </div>
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
                cell: ({ row }) => number(allocatedGpuCount(row.original)),
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
          <Panel
            title={`${t("common.mtd")} · ${t("common." + p.defaultRegion)}`}
            hint={t("project.costUsageBasis")}
          >
            <strong className="stat-value">{money(p.monthCost)}</strong>
          </Panel>
          <Panel
            title={t("overview.trend")}
            hint={`${t("project.costTrendScope")} · ${t("common." + p.defaultRegion)}`}
          >
            <Suspense fallback={<Loading />}>
              <TrendChart data={p.costTrendMonth} />
            </Suspense>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
