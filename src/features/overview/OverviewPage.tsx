import "./overview.css";
import { poolDisplayName } from "../../lib/gpu-labels";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Cpu,
  Layers3,
  Wallet,
  TrendingUp,
  Settings2,
  Plus,
  ArrowUpRight,
  Activity,
  BarChart3,
  Bell,
  Clock3,
  FolderKanban,
  Gauge,
  History,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import {
  KINDS,
  REGIONS,
  POOLS,
  type PoolCode,
  type Region,
  type Resource,
  type Quota,
  type ResourceEvent,
  type Account,
} from "../../types/domain";
import { formatResourceId, KIND_META, resourceLink } from "../../lib/ids";
import { date } from "../../lib/date";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { EP } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { t, dt } from "../../i18n";
import { money, number } from "../../lib/money";
import {
  Button,
  PageHeader,
  Progress,
  Empty,
  Loading,
  ErrorState,
  Modal,
  Check,
  EventTimeline,
  Badge,
} from "../../components/ui";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button as UiButton } from "../../components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
interface Overview {
  running: number;
  allocated: number;
  month: number;
  today: number;
  hourly: number;
  balance: number;
  remainingHours: number | null;
  resources: Resource[];
  distribution: {
    region: string;
    kind: (typeof KINDS)[number];
    gpuCount: number;
    unitCount: number;
    nodeCount: number;
  }[];
  quotas: Quota[];
  trend: Record<string, unknown>[];
  events: ResourceEvent[];
  alerts: { id: string; resource: Resource }[];
  account: Account;
  projects: { id: string; name: string; defaultRegion: Region }[];
}
const modules = [
  "insights",
  "health",
  "matrix",
  "quotas",
  "spendMix",
  "trend",
  "recentDeployments",
  "alerts",
  "activity",
];
const resourceStatuses = [
  "running",
  "stopped",
  "provisioning",
  "error",
  "terminating",
] as const;
const statusColors = {
  running: "var(--rs-success)",
  stopped: "var(--rs-text-muted)",
  provisioning: "var(--rs-info)",
  error: "var(--rs-danger)",
  terminating: "var(--rs-warning)",
};
function initialHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem("rs.overview.modules") || "[]");
  } catch {
    return [];
  }
}
function OverviewPanel({
  title,
  hint,
  action,
  icon: Icon,
  children,
  className = "",
}: {
  title: ReactNode;
  hint?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`panel overview-panel ${className}`}>
      <CardHeader className="panel-head flex flex-row items-center justify-between px-5 py-4">
        <div className="overview-panel-heading">
          {Icon && (
            <span className="overview-panel-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
          )}
          <div className="overview-panel-heading-copy">
            <CardTitle>{title}</CardTitle>
            {hint && <CardDescription>{hint}</CardDescription>}
          </div>
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="panel-body px-5 py-5">{children}</CardContent>
    </Card>
  );
}
function buildOverviewMetrics(data: Overview) {
  const gpuByModel = Object.fromEntries(
    POOLS.map((model) => [
      model,
      Object.fromEntries(REGIONS.map((region) => [region, 0])),
    ]),
  ) as Record<PoolCode, Record<Region, number>>;
  for (const resource of data.resources) {
    if (resource.status !== "running" && resource.status !== "provisioning")
      continue;
    if (resource.kind === "vgpu") {
      for (const pool of resource.spec.nodePools)
        gpuByModel[pool.poolCode][resource.region] +=
          pool.nodeCount * pool.gpuPerNode;
    } else {
      gpuByModel[resource.nodePool][resource.region] += resource.spec.gpuCount;
    }
  }
  const gpuRegionTotals = Object.fromEntries(
    REGIONS.map((region) => [region, 0]),
  ) as Record<Region, number>;
  const distributionByRegionKind = new Map<
    string,
    Overview["distribution"][number]
  >();
  for (const item of data.distribution) {
    gpuRegionTotals[item.region as Region] += item.gpuCount;
    distributionByRegionKind.set(`${item.region}:${item.kind}`, item);
  }
  const gpuRegionTotal = REGIONS.reduce(
    (total, region) => total + gpuRegionTotals[region],
    0,
  );
  const gpuModels = POOLS.map((code) => ({
    code,
    name: poolDisplayName(code),
    regions: gpuByModel[code],
    total: REGIONS.reduce((sum, region) => sum + gpuByModel[code][region], 0),
  })).sort((left, right) => right.total - left.total);
  const largestGpuModel = Math.max(1, ...gpuModels.map((model) => model.total));
  const resourcesByProject = new Map<string, Resource[]>();
  for (const resource of data.resources) {
    const list = resourcesByProject.get(resource.projectId);
    if (list) list.push(resource);
    else resourcesByProject.set(resource.projectId, [resource]);
  }
  const projects = data.projects
    .map((project) => {
      const resources = resourcesByProject.get(project.id) || [];
      return {
        ...project,
        resourceCount: resources.length,
        gpuCount: resources
          .filter((r) => r.status === "running" || r.status === "provisioning")
          .reduce((total, r) => total + r.spec.gpuCount, 0),
        spend30d: data.trend.reduce(
          (total, day) => total + Number(day[project.id] || 0),
          0,
        ),
      };
    })
    .sort((a, b) => b.spend30d - a.spend30d);
  const resourcesByKind = new Map<string, Resource[]>();
  for (const resource of data.resources) {
    const list = resourcesByKind.get(resource.kind);
    if (list) list.push(resource);
    else resourcesByKind.set(resource.kind, [resource]);
  }
  const health = KINDS.map((kind) => {
    const resources = resourcesByKind.get(kind) || [];
    const counts = Object.fromEntries(
      resourceStatuses.map((status) => [status, 0]),
    ) as Record<(typeof resourceStatuses)[number], number>;
    for (const resource of resources) counts[resource.status] += 1;
    return { kind, total: resources.length, counts };
  });
  const spendMix = ([...KINDS, "eip", "storage"] as const)
    .map((kind) => ({
      kind,
      amount: data.trend.reduce(
        (total, day) => total + Number(day[kind] || 0),
        0,
      ),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const spendTotal = spendMix.reduce((total, row) => total + row.amount, 0);
  const recentResources = data.resources
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const projectsById = new Map(
    data.projects.map((project) => [project.id, project]),
  );
  const quotaWarnings = data.quotas.filter(
    (quota) => quota.usedValue / quota.limitValue >= 0.8,
  );
  return {
    gpuRegionTotals,
    distributionByRegionKind,
    projectsById,
    gpuRegionTotal,
    gpuModels,
    largestGpuModel,
    projects,
    health,
    spendMix,
    spendTotal,
    recentResources,
    quotaWarnings,
  };
}

export default function OverviewPage() {
  const q = useData<Overview>(["overview"], EP.overview, { poll: true });
  const metrics = useMemo(
    () => (q.data ? buildOverviewMetrics(q.data) : null),
    [q.data],
  );
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const [custom, setCustom] = useState(false);
  const [grouping, setGrouping] = useState("total");
  const [expandedAlerts, setExpandedAlerts] = useState(false);
  const [hoveredGpuRegion, setHoveredGpuRegion] = useState<Region | null>(null);
  const [hoveredSpendKind, setHoveredSpendKind] = useState<
    (typeof KINDS)[number] | "eip" | "storage" | null
  >(null);
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const data = q.data;
  const show = (id: string) => !hidden.includes(id);
  const {
    gpuRegionTotals,
    distributionByRegionKind,
    projectsById,
    gpuRegionTotal,
    gpuModels,
    largestGpuModel,
    projects,
    health,
    spendMix,
    spendTotal,
    recentResources,
    quotaWarnings,
  } = metrics!;
  const gpuRegionChartData = REGIONS.map((region) => ({
    region,
    name: t(`common.${region}`),
    cards: gpuRegionTotals[region],
  }));
  const hoveredSpend = spendMix.find((item) => item.kind === hoveredSpendKind);
  const attentionItems: ReactNode[] = [];
  if (data.balance < data.account.lowBalanceThresholdUsd) {
    attentionItems.push(
      <Link key="low-balance" className="notice warning" to="/billing/bills">
        {t("billing.lowBalance")}
      </Link>,
    );
  }
  for (const alert of data.alerts) {
    attentionItems.push(
      <Link
        key={alert.id}
        className="notice warning"
        to={resourceLink(alert.resource)}
      >
        <span>
          {dt(alert.resource.name)} · {t("common.error")}
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>,
    );
  }
  for (const quota of quotaWarnings) {
    attentionItems.push(
      <Link
        key={`${quota.region}-${quota.metric}`}
        className="notice warning"
        to="/ops/quotas"
      >
        {t(`common.${quota.region}`)} · {t(`quota.${quota.metric}`)}{" "}
        {number((quota.usedValue / quota.limitValue) * 100, 1)}%
      </Link>,
    );
  }
  return (
    <>
      <PageHeader
        title={t("overview.title")}
        subtitle={t("overview.subtitle")}
        actions={
          <Button onClick={() => setCustom(true)}>
            <Settings2 size={14} />
            {t("overview.customize")}
          </Button>
        }
      />
      <div className="overview-stats overview-summary-layout">
        <Card className="overview-stat-card overview-stat-primary overview-gpu-overview-card">
          <CardHeader>
            <CardDescription>{t("overview.allocated")}</CardDescription>
            <CardAction className="overview-stat-icon">
              <Cpu size={18} strokeWidth={2} aria-hidden="true" />
            </CardAction>
          </CardHeader>
          <CardContent className="overview-gpu-overview-content">
            <div
              className="overview-total-chart"
              role="img"
              aria-label={t("overview.gpuBarLabel", {
                model: t("overview.allocated"),
                breakdown: REGIONS.map(
                  (region) =>
                    `${region.toUpperCase()} ${number(gpuRegionTotals[region])}`,
                ).join(" · "),
              })}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      gpuRegionTotal
                        ? gpuRegionChartData
                        : [{ region: "jp", name: "", cards: 1 }]
                    }
                    dataKey="cards"
                    nameKey="name"
                    innerRadius="72%"
                    outerRadius="94%"
                    paddingAngle={gpuRegionTotal ? 3 : 0}
                    stroke="none"
                    isAnimationActive={false}
                    onMouseEnter={(_, index) =>
                      setHoveredGpuRegion(REGIONS[index] ?? null)
                    }
                    onMouseLeave={() => setHoveredGpuRegion(null)}
                  >
                    {gpuRegionTotal ? (
                      gpuRegionChartData.map(({ region }) => (
                        <Cell
                          key={region}
                          fill={`var(--overview-region-${region})`}
                        />
                      ))
                    ) : (
                      <Cell fill="var(--rs-border)" />
                    )}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="overview-total-chart-center" aria-hidden="true">
                <strong>
                  {number(
                    hoveredGpuRegion
                      ? gpuRegionTotals[hoveredGpuRegion]
                      : data.allocated,
                  )}
                </strong>
                <span>
                  {hoveredGpuRegion ? t(`common.${hoveredGpuRegion}`) : "GPU"}
                </span>
              </div>
            </div>
            <div className="overview-region-breakdown">
              {REGIONS.map((region) => (
                <div
                  className="overview-region-row"
                  data-active={hoveredGpuRegion === region}
                  key={region}
                >
                  <span className="overview-region-name">
                    <i className={`overview-gpu-key region-${region}`} />
                    {t(`common.${region}`)}
                  </span>
                  <span className="overview-region-amount">
                    <strong>{number(gpuRegionTotals[region])}</strong>
                    <small>
                      {number(
                        gpuRegionTotal
                          ? (gpuRegionTotals[region] / gpuRegionTotal) * 100
                          : 0,
                        1,
                      )}
                      %
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <section
          className="overview-finance-stack"
          aria-label={t("overview.financialOverview")}
        >
          <h2 className="overview-finance-heading">
            {t("overview.financialOverview")}
          </h2>
          {[
            {
              label: t("common.mtd"),
              value: money(data.month),
              note: t("common.scope"),
              icon: TrendingUp,
            },
            {
              label: t("common.today"),
              value: money(data.today),
              note: `${new Date().toISOString().slice(0, 10)} · ${t("billing.todayBasis")}`,
              icon: TrendingUp,
            },
            {
              label: t("common.balance"),
              value: money(data.balance),
              note:
                t("common.runtime") +
                " " +
                (data.remainingHours
                  ? number(data.remainingHours, 1) + "h"
                  : "—"),
              icon: Wallet,
            },
          ].map((item) => (
            <Card
              className="overview-stat-card overview-finance-card"
              key={item.label}
            >
              <CardHeader>
                <span className="overview-stat-icon" aria-hidden="true">
                  <item.icon size={17} />
                </span>
                <div className="overview-finance-labels">
                  <CardDescription>{item.label}</CardDescription>
                  <p className="overview-stat-note">{item.note}</p>
                </div>
              </CardHeader>
              <CardContent>
                <strong className="overview-stat-value">{item.value}</strong>
              </CardContent>
            </Card>
          ))}
        </section>
        <section
          className="overview-action-bar"
          aria-label={t("overview.quickDeploy")}
        >
          <div className="overview-deploy-mark" aria-hidden="true">
            <Layers3 size={25} />
          </div>
          <div className="overview-action-copy">
            <strong>{t("overview.quickDeploy")}</strong>
            <span>{t("overview.quickDeployHint")}</span>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                className="overview-deploy-trigger"
                disabled={!canWrite(role)}
              >
                <LayoutGrid size={16} />
                {t("overview.chooseResource")}
                <Plus size={16} className="overview-deploy-plus" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="overview-deploy-popover"
              align="end"
              sideOffset={10}
              aria-label={t("overview.quickDeploy")}
            >
              <h2 className="overview-deploy-menu-heading">
                {t("overview.chooseResource")}
              </h2>
              <div className="overview-deploy-options">
                {KINDS.map((kind) => {
                  const Icon = KIND_META[kind].icon;
                  return (
                    <Button
                      key={kind}
                      disabled={!canWrite(role)}
                      onClick={() =>
                        navigate(`/deployment/${KIND_META[kind].deployKey}`)
                      }
                    >
                      <span
                        className="overview-deploy-option-icon"
                        style={{ color: KIND_META[kind].color }}
                      >
                        <Icon size={18} />
                      </span>
                      {t(`common.${kind}`)}
                      <ArrowUpRight
                        size={15}
                        className="overview-deploy-arrow"
                      />
                    </Button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </section>
      </div>
      <div className="stack section-gap">
        {show("alerts") && (
          <OverviewPanel
            title={t("overview.alerts")}
            icon={Bell}
            className="overview-alert-panel"
            action={
              attentionItems.length > 2 ? (
                <Button onClick={() => setExpandedAlerts((value) => !value)}>
                  {expandedAlerts
                    ? t("overview.alertLess")
                    : t("overview.alertMore", {
                        count: attentionItems.length - 2,
                      })}
                </Button>
              ) : undefined
            }
          >
            {attentionItems.length ? (
              <div className="overview-alert-grid">
                {(expandedAlerts
                  ? attentionItems
                  : attentionItems.slice(0, 2)
                ).map((item) => item)}
              </div>
            ) : (
              <p className="overview-no-alerts">
                {t("header.noNotifications")}
              </p>
            )}
          </OverviewPanel>
        )}
        {show("insights") && (
          <div className="grid grid-2 overview-insights">
            <OverviewPanel
              title={t("overview.gpuModels")}
              icon={Layers3}
              className="overview-gpu-panel"
              hint={t("overview.gpuModelsScope")}
              action={
                <Link to="/deployment/server">
                  {t("overview.viewGpuSpecs")}
                </Link>
              }
            >
              <div className="overview-gpu-summary">
                <strong>
                  {t("overview.gpuModelCount", { count: gpuModels.length })}
                </strong>
                <span className="muted">
                  {t("overview.gpuRegionCount", { count: REGIONS.length })}
                </span>
              </div>
              <div
                className="overview-gpu-chart"
                role="img"
                aria-label={t("overview.gpuModels")}
                style={{
                  height: `${Math.max(186, gpuModels.length * 36 + 28)}px`,
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={gpuModels}
                    layout="vertical"
                    margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
                    barCategoryGap="24%"
                  >
                    <CartesianGrid
                      horizontal={false}
                      stroke="var(--rs-border)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      type="number"
                      domain={[0, Math.max(1, largestGpuModel)]}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => number(Number(value))}
                      stroke="var(--rs-text-secondary)"
                      fontSize={11}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={104}
                      tickLine={false}
                      axisLine={false}
                      stroke="var(--rs-text-secondary)"
                      fontSize={11}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--rs-surface-2)" }}
                      contentStyle={{
                        background: "var(--rs-bg)",
                        border: "1px solid var(--rs-border)",
                        borderRadius: 8,
                      }}
                      formatter={(value) => [
                        t("overview.gpuCards", {
                          count: number(Number(value)),
                        }),
                        t("overview.allocated"),
                      ]}
                    />
                    <Bar
                      dataKey="total"
                      fill="var(--rs-brand)"
                      radius={[0, 5, 5, 0]}
                      maxBarSize={20}
                      minPointSize={1}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="total"
                        position="right"
                        formatter={(value) => number(Number(value))}
                        className="overview-gpu-total-label"
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {gpuModels.some((model) => model.total === 0) && (
                <small className="muted">{t("overview.gpuZeroNote")}</small>
              )}
            </OverviewPanel>
            <OverviewPanel
              title={t("overview.projectLoad")}
              icon={FolderKanban}
              hint={t("overview.projectLoadScope")}
              action={
                <Link to="/ops/projects">{t("overview.viewProjects")}</Link>
              }
            >
              {projects.length ? (
                <div className="overview-project-list">
                  <div className="overview-project-heading">
                    <span>{t("common.project")}</span>
                    <span>{t("overview.currentAllocation")}</span>
                    <span>{t("overview.spend30d")}</span>
                  </div>
                  {projects.slice(0, 4).map((project) => (
                    <Link
                      className="overview-project-row"
                      key={project.id}
                      to={`/ops/projects/${project.id}`}
                    >
                      <span className="overview-project-name">
                        {dt(project.name)} ·{" "}
                        {t("common." + project.defaultRegion)}
                      </span>
                      <span className="muted">
                        {t("overview.projectResources", {
                          count: number(project.resourceCount),
                        })}
                        {" · "}
                        {number(project.gpuCount)} GPU
                      </span>
                      <strong className="mono">
                        {money(project.spend30d)}
                      </strong>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty text={t("overview.noProjects")} />
              )}
            </OverviewPanel>
          </div>
        )}
        {(show("health") || show("spendMix")) && (
          <div
            className={
              show("health") && show("spendMix")
                ? "grid grid-2 overview-operations"
                : "grid overview-operations"
            }
          >
            {show("health") && (
              <OverviewPanel
                title={t("overview.health")}
                icon={Activity}
                hint={t("overview.healthScope")}
              >
                <div className="overview-health-list">
                  {health.map((item) => {
                    const Icon = KIND_META[item.kind].icon;
                    return (
                      <div className="overview-health-tile" key={item.kind}>
                        <div className="overview-health-tile-heading">
                          <span
                            className="overview-health-icon"
                            style={{ color: KIND_META[item.kind].color }}
                          >
                            <Icon size={17} aria-hidden="true" />
                          </span>
                          <strong>{t("common." + item.kind)}</strong>
                        </div>
                        <div className="overview-health-metric">
                          <strong>{number(item.counts.running)}</strong>
                          <span>/ {number(item.total)}</span>
                          <small className="mono">
                            {number(
                              item.total
                                ? (item.counts.running / item.total) * 100
                                : 0,
                              1,
                            )}
                            %
                          </small>
                        </div>
                        <div className="overview-health-caption">
                          <span>{t("common.running")}</span>
                          {item.counts.stopped > 0 && (
                            <span className="overview-health-stopped">
                              <i
                                className="overview-status-dot"
                                style={{ background: statusColors.stopped }}
                              />
                              {t("common.stopped")}{" "}
                              {number(item.counts.stopped)}
                            </span>
                          )}
                        </div>
                        <div
                          className="overview-health-track"
                          aria-hidden="true"
                        >
                          {resourceStatuses.map((status) =>
                            item.counts[status] ? (
                              <span
                                key={status}
                                style={{
                                  width: `${(item.counts[status] / item.total) * 100}%`,
                                  background: statusColors[status],
                                }}
                              />
                            ) : null,
                          )}
                        </div>
                        {resourceStatuses.some(
                          (status) =>
                            status !== "running" &&
                            status !== "stopped" &&
                            item.counts[status] > 0,
                        ) && (
                          <div className="overview-health-statuses">
                            {resourceStatuses
                              .filter(
                                (status) =>
                                  status !== "running" &&
                                  item.counts[status] > 0,
                              )
                              .map((status) => (
                                <small key={status}>
                                  <span
                                    className="overview-status-dot"
                                    style={{ background: statusColors[status] }}
                                  />
                                  {t("common." + status)}{" "}
                                  {number(item.counts[status])}
                                </small>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </OverviewPanel>
            )}
            {show("spendMix") && (
              <OverviewPanel
                title={t("overview.spendMix")}
                icon={BarChart3}
                hint={t("overview.spendMixScope")}
                action={
                  <Link to="/billing/cost">{t("overview.viewCost")}</Link>
                }
              >
                {spendTotal > 0 ? (
                  <div className="overview-spend-layout">
                    <div
                      className="overview-spend-donut"
                      role="img"
                      aria-label={
                        t("overview.spendMix") + " " + money(spendTotal)
                      }
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={spendMix}
                            dataKey="amount"
                            nameKey="kind"
                            cx="50%"
                            cy="50%"
                            innerRadius={68}
                            outerRadius={88}
                            paddingAngle={2}
                            stroke="none"
                            isAnimationActive={false}
                            onMouseEnter={(_, index) =>
                              setHoveredSpendKind(spendMix[index]?.kind ?? null)
                            }
                            onMouseLeave={() => setHoveredSpendKind(null)}
                          >
                            {spendMix.map((item) => (
                              <Cell
                                key={item.kind}
                                fill={
                                  item.kind === "eip"
                                    ? "var(--rs-info)"
                                    : item.kind === "storage"
                                      ? "var(--rs-warning)"
                                      : KIND_META[item.kind].color
                                }
                              />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div
                        className="overview-spend-donut-center"
                        aria-hidden="true"
                      >
                        <span>
                          {hoveredSpend
                            ? t("common." + hoveredSpend.kind)
                            : t("common.total")}
                        </span>
                        <strong>
                          {money(hoveredSpend?.amount ?? spendTotal)}
                        </strong>
                      </div>
                    </div>
                    <div className="overview-spend-list">
                      {spendMix.map((item) => (
                        <div
                          className="overview-spend-item"
                          data-active={hoveredSpendKind === item.kind}
                          key={item.kind}
                        >
                          <span className="overview-spend-name">
                            <i
                              style={{
                                background:
                                  item.kind === "eip"
                                    ? "var(--rs-info)"
                                    : item.kind === "storage"
                                      ? "var(--rs-warning)"
                                      : KIND_META[item.kind].color,
                              }}
                            />
                            {t("common." + item.kind)}
                          </span>
                          <strong className="mono">{money(item.amount)}</strong>
                          <small className="mono muted">
                            {number((item.amount / spendTotal) * 100, 1)}%
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Empty text={t("overview.noSpend")} />
                )}
              </OverviewPanel>
            )}
          </div>
        )}
        {show("matrix") && (
          <OverviewPanel
            title={t("overview.matrix")}
            icon={LayoutGrid}
            hint={t("overview.matrixScope")}
          >
            <div className="overview-distribution">
              {REGIONS.map((region) => (
                <Card className="overview-distribution-region" key={region}>
                  <CardHeader>
                    <div className="overview-distribution-region-heading">
                      <span
                        className="overview-distribution-flag"
                        role="img"
                        aria-label={t(`common.${region}`)}
                      >
                        <img
                          src={`/flags/${region}.svg`}
                          alt=""
                          aria-hidden="true"
                          width="29"
                          height="22"
                        />
                      </span>
                      <div>
                        <CardTitle>{t("common." + region)}</CardTitle>
                        <CardDescription>
                          {t("overview.allocated")}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="overview-distribution-region-total">
                      <strong>{number(gpuRegionTotals[region])}</strong>
                      <span>GPU</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {KINDS.map((kind) => {
                      const cell = distributionByRegionKind.get(
                        `${region}:${kind}`,
                      );
                      const Icon = KIND_META[kind].icon;
                      return (
                        <UiButton
                          key={kind}
                          type="button"
                          variant="ghost"
                          className="overview-distribution-resource"
                          disabled={!cell?.unitCount}
                          onClick={() =>
                            navigate(
                              `/resources/${KIND_META[kind].routeKey}?region=${region}`,
                            )
                          }
                        >
                          <span
                            className="overview-distribution-icon"
                            style={{ color: KIND_META[kind].color }}
                          >
                            <Icon size={18} aria-hidden="true" />
                          </span>
                          <span className="overview-distribution-resource-copy">
                            <strong>{t("common." + kind)}</strong>
                            <small>
                              {t("overview.units." + kind, {
                                count: number(cell?.unitCount ?? 0),
                              })}
                              {kind === "vgpu" && cell?.nodeCount
                                ? " · " +
                                  t("overview.nodes", {
                                    count: number(cell.nodeCount),
                                  })
                                : ""}
                            </small>
                          </span>
                          <span className="overview-distribution-resource-gpu">
                            <strong>{number(cell?.gpuCount ?? 0)}</strong>
                            <small>GPU</small>
                          </span>
                          {cell?.unitCount ? (
                            <ArrowUpRight size={15} aria-hidden="true" />
                          ) : null}
                        </UiButton>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
            </div>
          </OverviewPanel>
        )}
        {show("quotas") && (
          <OverviewPanel
            title={t("overview.quotas")}
            icon={Gauge}
            hint={t("overview.quotaScope")}
          >
            <div className="grid grid-3 overview-quota-regions">
              {REGIONS.map((region) => (
                <div className="overview-quota-region" key={region}>
                  <h3>
                    {t(`common.${region}`)}
                    <span className="muted">{region.toUpperCase()}</span>
                  </h3>
                  <div className="overview-quota-metrics">
                    {data.quotas
                      .filter((q) => q.region === region)
                      .flatMap((quota) =>
                        quota.metric === "storage"
                          ? (quota.storageBreakdown || []).map((storage) => (
                              <div
                                className="quota-line"
                                key={`${quota.metric}-${storage.kind}`}
                              >
                                <div className="between">
                                  <small>
                                    {t(`quota.storage.${storage.kind}`)}
                                  </small>
                                  <small className="mono">
                                    {number(storage.usedGb / 1000)} /{" "}
                                    {number(storage.limitGb / 1000)} TB
                                  </small>
                                </div>
                                <Progress
                                  value={
                                    (storage.usedGb / storage.limitGb) * 100
                                  }
                                />
                              </div>
                            ))
                          : [
                              <div className="quota-line" key={quota.metric}>
                                <div className="between">
                                  <small>{t(`quota.${quota.metric}`)}</small>
                                  <small className="mono">
                                    {number(quota.usedValue)} /{" "}
                                    {number(quota.limitValue)}
                                  </small>
                                </div>
                                <Progress
                                  value={
                                    (quota.usedValue / quota.limitValue) * 100
                                  }
                                />
                              </div>,
                            ],
                      )}
                  </div>
                </div>
              ))}
            </div>
          </OverviewPanel>
        )}
        {show("trend") && (
          <OverviewPanel
            title={t("overview.trend")}
            icon={TrendingUp}
            hint={t("overview.trendScope")}
            action={
              <div
                className="overview-trend-segments"
                role="group"
                aria-label={t("billing.dimensions")}
              >
                <span
                  className="overview-trend-lens"
                  aria-hidden="true"
                  style={{
                    transform: `translateX(${["total", "kind", "project"].indexOf(grouping) * 100}%)`,
                  }}
                />
                {[
                  { value: "total", label: t("common.total") },
                  { value: "kind", label: t("overview.byType") },
                  { value: "project", label: t("overview.byProject") },
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    aria-pressed={grouping === value}
                    onClick={() => setGrouping(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            }
          >
            <Suspense fallback={<Loading />}>
              <TrendChart
                data={data.trend.filter(
                  (row) => new Date(String(row.date)).getTime() <= Date.now(),
                )}
                keys={
                  grouping === "kind"
                    ? [...KINDS, "eip"]
                    : grouping === "project"
                      ? (data.projects || []).map((p) => p.id)
                      : ["amount"]
                }
                labels={Object.fromEntries(
                  (data.projects || []).map((p) => [
                    p.id,
                    `${dt(p.name)} · ${t("common." + p.defaultRegion)}`,
                  ]),
                )}
              />
            </Suspense>
          </OverviewPanel>
        )}
        {show("recentDeployments") && (
          <OverviewPanel
            title={t("overview.recentDeployments")}
            icon={Clock3}
            hint={t("overview.recentDeploymentsScope")}
          >
            {recentResources.length ? (
              <div className="table-wrap overview-recent-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("common.name")}</th>
                      <th>{t("common.type")}</th>
                      <th>{t("common.project")}</th>
                      <th>{t("common.region")}</th>
                      <th>GPU</th>
                      <th>{t("common.status")}</th>
                      <th>{t("common.createdAt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentResources.map((resource) => (
                      <tr key={resource.resourceUuid}>
                        <td>
                          <Link to={resourceLink(resource)}>
                            {dt(resource.name)}
                          </Link>
                          <small className="muted mono overview-recent-id">
                            {resource.displayId}
                          </small>
                        </td>
                        <td>{t("common." + resource.kind)}</td>
                        <td>
                          {dt(
                            projectsById.get(resource.projectId)?.name ||
                              formatResourceId("prj", resource.projectId),
                          )}
                        </td>
                        <td>{t("common." + resource.region)}</td>
                        <td className="mono">
                          {number(resource.spec.gpuCount)}
                        </td>
                        <td>
                          <Badge status={resource.status} />
                        </td>
                        <td>{date(resource.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text={t("overview.noResources")} />
            )}
          </OverviewPanel>
        )}
        {show("activity") && (
          <OverviewPanel
            title={t("overview.activity")}
            icon={History}
            hint={t("overview.activityScope")}
          >
            <EventTimeline
              events={data.events.slice(0, 6).map((e) => ({
                ...e,
                reason: dt(e.reason),
                action: dt(e.action),
              }))}
            />
          </OverviewPanel>
        )}
      </div>
      <Modal
        open={custom}
        onClose={() => setCustom(false)}
        title={t("overview.customize")}
      >
        <div className="stack">
          {modules.map((id) => (
            <Check
              key={id}
              label={t(`overview.${id}`)}
              checked={show(id)}
              onChange={(checked) => {
                const next = checked
                  ? hidden.filter((x) => x !== id)
                  : [...hidden, id];
                setHidden(next);
                localStorage.setItem(
                  "rs.overview.modules",
                  JSON.stringify(next),
                );
              }}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}
