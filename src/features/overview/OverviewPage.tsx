import "./overview.css";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Cpu,
  Wallet,
  TrendingUp,
  Settings2,
  Plus,
  ArrowUpRight,
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
import { KIND_META, resourceLink } from "../../lib/ids";
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
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
  projects: { id: string; name: string }[];
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
  children,
  className = "",
}: {
  title: ReactNode;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`panel overview-panel ${className}`}>
      <CardHeader className="panel-head flex flex-row items-center justify-between px-5 py-4">
        <div className="overview-panel-heading">
          <CardTitle>{title}</CardTitle>
          {hint && <CardDescription>{hint}</CardDescription>}
        </div>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="panel-body px-5 py-5">{children}</CardContent>
    </Card>
  );
}
export default function OverviewPage() {
  const q = useData<Overview>(["overview"], EP.overview, { poll: true });
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const [custom, setCustom] = useState(false);
  const [grouping, setGrouping] = useState("total");
  const [expandedAlerts, setExpandedAlerts] = useState(false);
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const data = q.data;
  const show = (id: string) => !hidden.includes(id);
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
  const gpuModels = POOLS.map((code) => ({
    code,
    name: code.replaceAll("_", " "),
    regions: gpuByModel[code],
    total: REGIONS.reduce((sum, region) => sum + gpuByModel[code][region], 0),
  })).sort((left, right) => right.total - left.total);
  const largestGpuModel = Math.max(1, ...gpuModels.map((model) => model.total));
  const projects = data.projects
    .map((project) => {
      const resources = data.resources.filter(
        (r) => r.projectId === project.id,
      );
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
  const health = KINDS.map((kind) => {
    const resources = data.resources.filter(
      (resource) => resource.kind === kind,
    );
    return {
      kind,
      total: resources.length,
      counts: Object.fromEntries(
        resourceStatuses.map((status) => [
          status,
          resources.filter((resource) => resource.status === status).length,
        ]),
      ) as Record<(typeof resourceStatuses)[number], number>,
    };
  });
  const spendMix = ([...KINDS, "eip"] as const)
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
  const quotaWarnings = data.quotas.filter(
    (quota) => quota.usedValue / quota.limitValue >= 0.8,
  );
  const attentionItems: ReactNode[] = [];
  if (data.balance < data.account.lowBalanceThresholdUsd) {
    attentionItems.push(
      <Link key="low-balance" className="notice warning" to="/billing/bills">
        {t("billing.lowBalance")}
      </Link>,
    );
  }
  if (data.month > data.account.budget) {
    attentionItems.push(
      <Link key="over-budget" className="notice warning" to="/billing/cost">
        {t("billing.overBudget")}
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
      <div className="grid overview-stats">
        <Card className="overview-stat-card overview-stat-primary">
          <CardHeader>
            <CardDescription>{t("overview.allocated")}</CardDescription>
            <CardAction className="overview-stat-icon">
              <Cpu size={17} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="overview-stat-value">{number(data.allocated)}</div>
          </CardContent>
          <CardFooter className="overview-region-summary">
            {REGIONS.map((region) => (
              <span key={region} title={t("common." + region)}>
                <span className={`overview-gpu-key region-${region}`} />
                {region.toUpperCase()}
                <strong>
                  {number(
                    data.distribution
                      .filter((item) => item.region === region)
                      .reduce((total, item) => total + item.gpuCount, 0),
                  )}
                </strong>
              </span>
            ))}
          </CardFooter>
        </Card>
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
          <Card className="overview-stat-card" key={item.label}>
            <CardHeader>
              <CardDescription>{item.label}</CardDescription>
              <CardAction className="overview-stat-icon">
                <item.icon size={17} />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="overview-stat-value">{item.value}</div>
              <p className="overview-stat-note">{item.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="overview-action-bar">
        <div className="overview-action-copy">
          <strong>{t("overview.quickDeploy")}</strong>
          <span>{t("overview.quickDeployHint")}</span>
        </div>
        <div className="overview-action-buttons">
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
                <Icon size={15} style={{ color: KIND_META[kind].color }} />
                <Plus size={12} />
                {t(`common.${kind}`)}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="stack section-gap">
        {show("alerts") && (
          <OverviewPanel
            title={t("overview.alerts")}
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
              <div className="overview-gpu-legend">
                {REGIONS.map((region) => (
                  <span key={region}>
                    <i className={`overview-gpu-key region-${region}`} />
                    {region.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="overview-gpu-list">
                {gpuModels.map((model) => (
                  <div className="overview-gpu-row" key={model.code}>
                    <div className="between">
                      <strong>{model.name}</strong>
                      <span className="mono">
                        {t("overview.gpuCards", { count: number(model.total) })}
                      </span>
                    </div>
                    <div
                      className="overview-gpu-track"
                      role="img"
                      aria-label={t("overview.gpuBarLabel", {
                        model: model.name,
                        breakdown: REGIONS.map(
                          (region) =>
                            `${region.toUpperCase()} ${number(model.regions[region])}`,
                        ).join(" · "),
                      })}
                    >
                      {REGIONS.map((region) =>
                        model.regions[region] ? (
                          <span
                            key={region}
                            className={`overview-gpu-segment region-${region}`}
                            style={{
                              width: `${(model.regions[region] / largestGpuModel) * 100}%`,
                            }}
                            title={`${region.toUpperCase()} · ${number(model.regions[region])}`}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <small className="muted">{t("overview.gpuZeroNote")}</small>
            </OverviewPanel>
            <OverviewPanel
              title={t("overview.projectLoad")}
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
                        {dt(project.name)}
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
                hint={t("overview.healthScope")}
              >
                <div className="overview-health-list">
                  {health.map((item) => {
                    const Icon = KIND_META[item.kind].icon;
                    return (
                      <div className="overview-health-row" key={item.kind}>
                        <div className="between">
                          <span className="row">
                            <Icon
                              size={16}
                              style={{ color: KIND_META[item.kind].color }}
                            />
                            <strong>{t("common." + item.kind)}</strong>
                          </span>
                          <span className="mono">
                            {t("overview.healthCount", {
                              running: number(item.counts.running),
                              total: number(item.total),
                            })}
                          </span>
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
                        <div className="overview-health-statuses">
                          {resourceStatuses.map((status) =>
                            item.counts[status] ? (
                              <small key={status}>
                                <span
                                  className="overview-status-dot"
                                  style={{ background: statusColors[status] }}
                                />
                                {t("common." + status)}{" "}
                                {number(item.counts[status])}
                              </small>
                            ) : null,
                          )}
                          {!item.total && <small className="muted">—</small>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </OverviewPanel>
            )}
            {show("spendMix") && (
              <OverviewPanel
                title={t("overview.spendMix")}
                hint={t("overview.spendMixScope")}
                action={
                  <Link to="/billing/cost">{t("overview.viewCost")}</Link>
                }
              >
                {spendTotal > 0 ? (
                  <div className="overview-spend-list">
                    {spendMix.map((item) => (
                      <div className="overview-spend-row" key={item.kind}>
                        <div className="between">
                          <span>{t("common." + item.kind)}</span>
                          <strong className="mono">{money(item.amount)}</strong>
                        </div>
                        <div className="overview-spend-track">
                          <span
                            style={{
                              width: `${(item.amount / spendTotal) * 100}%`,
                              background:
                                item.kind === "eip"
                                  ? "var(--rs-info)"
                                  : KIND_META[item.kind].color,
                            }}
                          />
                        </div>
                        <small className="muted mono">
                          {number((item.amount / spendTotal) * 100, 1)}%
                        </small>
                      </div>
                    ))}
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
            hint={t("overview.matrixScope")}
          >
            <div className="table-wrap overview-distribution">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.type")}</th>
                    {REGIONS.map((region) => (
                      <th key={region}>
                        {t("common." + region)} · {region.toUpperCase()}
                      </th>
                    ))}
                    <th>{t("overview.gpuTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {KINDS.map((kind) => {
                    const Icon = KIND_META[kind].icon;
                    return (
                      <tr key={kind}>
                        <td>
                          <span className="row">
                            <Icon
                              size={16}
                              style={{ color: KIND_META[kind].color }}
                            />
                            {t("common." + kind)}
                          </span>
                        </td>
                        {REGIONS.map((region) => {
                          const cell = data.distribution.find(
                            (d) => d.kind === kind && d.region === region,
                          );
                          return (
                            <td key={region}>
                              {cell?.unitCount ? (
                                <button
                                  type="button"
                                  className="distribution-cell"
                                  onClick={() =>
                                    navigate(
                                      `/resources/${KIND_META[kind].routeKey}?region=${region}`,
                                    )
                                  }
                                >
                                  <strong className="mono">
                                    {number(cell.gpuCount)} <small>GPU</small>
                                  </strong>
                                  <small>
                                    {t("overview.units." + kind, {
                                      count: number(cell.unitCount),
                                    })}
                                    {kind === "vgpu"
                                      ? " · " +
                                        t("overview.nodes", {
                                          count: number(cell.nodeCount),
                                        })
                                      : ""}
                                  </small>
                                </button>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="mono">
                          {number(
                            data.distribution
                              .filter((d) => d.kind === kind)
                              .reduce((n, d) => n + d.gpuCount, 0),
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th>{t("overview.gpuTotal")}</th>
                    {REGIONS.map((region) => (
                      <td key={region} className="mono">
                        {number(
                          data.distribution
                            .filter((d) => d.region === region)
                            .reduce((n, d) => n + d.gpuCount, 0),
                        )}
                      </td>
                    ))}
                    <td className="mono">{number(data.allocated)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </OverviewPanel>
        )}
        {show("quotas") && (
          <OverviewPanel
            title={t("overview.quotas")}
            hint={t("overview.quotaScope")}
          >
            <div className="grid grid-3">
              {REGIONS.map((region) => (
                <div key={region}>
                  <h3>
                    {t(`common.${region}`)}{" "}
                    <span className="muted">{region.toUpperCase()}</span>
                  </h3>
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
                                value={(storage.usedGb / storage.limitGb) * 100}
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
              ))}
            </div>
          </OverviewPanel>
        )}
        {show("trend") && (
          <OverviewPanel
            title={t("overview.trend")}
            hint={t("overview.trendScope")}
            action={
              <select
                aria-label={t("billing.dimensions")}
                value={grouping}
                onChange={(e) => setGrouping(e.target.value)}
              >
                <option value="total">{t("common.total")}</option>
                <option value="kind">{t("overview.byType")}</option>
                <option value="project">{t("overview.byProject")}</option>
              </select>
            }
          >
            <Suspense fallback={<Loading />}>
              <TrendChart
                data={data.trend}
                keys={
                  grouping === "kind"
                    ? [...KINDS, "eip"]
                    : grouping === "project"
                      ? (data.projects || []).map((p) => p.id)
                      : ["amount"]
                }
                labels={Object.fromEntries(
                  (data.projects || []).map((p) => [p.id, dt(p.name)]),
                )}
              />
            </Suspense>
          </OverviewPanel>
        )}
        {show("recentDeployments") && (
          <OverviewPanel
            title={t("overview.recentDeployments")}
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
                            data.projects.find(
                              (project) => project.id === resource.projectId,
                            )?.name || resource.projectId,
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
