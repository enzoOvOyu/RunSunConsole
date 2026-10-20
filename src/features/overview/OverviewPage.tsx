import { lazy, Suspense, useState } from "react";
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
  type Resource,
  type Quota,
  type ResourceEvent,
  type Account,
} from "../../types/domain";
import { KIND_META, resourceLink } from "../../lib/ids";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { EP } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { t, dt } from "../../i18n";
import { money, number } from "../../lib/money";
import {
  Button,
  PageHeader,
  Panel,
  Progress,
  Empty,
  Loading,
  ErrorState,
  Modal,
  Check,
  EventTimeline,
} from "../../components/ui";
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
const modules = ["insights", "matrix", "quotas", "trend", "alerts", "activity"];
function initialHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem("rs.overview.modules") || "[]");
  } catch {
    return [];
  }
}
export default function OverviewPage() {
  const q = useData<Overview>(["overview"], EP.overview, { poll: true });
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const [custom, setCustom] = useState(false);
  const [grouping, setGrouping] = useState("total");
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const data = q.data;
  const show = (id: string) => !hidden.includes(id);
  const budget = data.account.budget;
  const budgetUsed = budget > 0 ? (data.month / budget) * 100 : 0;
  const projects = data.projects
    .map((project) => {
      const resources = data.resources.filter(
        (r) => r.projectId === project.id,
      );
      return {
        ...project,
        resourceCount: resources.length,
        gpuCount: resources.reduce((total, r) => total + r.spec.gpuCount, 0),
        spend30d: data.trend.reduce(
          (total, day) => total + Number(day[project.id] || 0),
          0,
        ),
      };
    })
    .sort((a, b) => b.spend30d - a.spend30d);
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
      <div className="row" style={{ marginBottom: 20 }}>
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
      <div className="grid overview-stats">
        {[
          {
            label: t("overview.allocated"),
            value: number(data.allocated),
            note: t("overview.allocatedScope"),
            icon: Cpu,
          },
          {
            label: t("common.mtd"),
            value: money(data.month),
            note: t("common.scope"),
            icon: TrendingUp,
          },
          {
            label: t("common.today"),
            value: money(data.today),
            note: new Date().toISOString().slice(0, 10) + " · UTC",
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
        ].map((s) => (
          <div className="panel stat" key={s.label}>
            <div className="stat-label">
              {s.label}
              <span className="stat-icon">
                <s.icon size={15} />
              </span>
            </div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-note">{s.note}</div>
          </div>
        ))}
      </div>
      <div className="stack section-gap">
        {show("insights") && (
          <div className="grid grid-2 overview-insights">
            <Panel
              title={t("overview.budgetHealth")}
              action={<Link to="/billing/cost">{t("overview.viewCost")}</Link>}
            >
              <div className="overview-budget-main">
                <div>
                  <small className="muted">{t("overview.budgetUsed")}</small>
                  <div className="overview-budget-value">
                    {number(budgetUsed, 1)}%
                  </div>
                </div>
                <div className="overview-budget-total">
                  <small className="muted">{t("common.budget")}</small>
                  <strong className="mono">{money(budget)}</strong>
                </div>
              </div>
              <Progress value={budgetUsed} />
              <div className="overview-budget-details">
                <div>
                  <small className="muted">
                    {t("overview.budgetRemaining")}
                  </small>
                  <strong className="mono">
                    {money(Math.max(0, budget - data.month))}
                  </strong>
                </div>
                <div>
                  <small className="muted">{t("overview.currentHourly")}</small>
                  <strong className="mono">
                    {money(data.hourly)}
                    {t("common.perHour")}
                  </strong>
                </div>
              </div>
            </Panel>
            <Panel
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
            </Panel>
          </div>
        )}
        {show("matrix") && (
          <Panel title={t("overview.matrix")} hint={t("overview.matrixScope")}>
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
          </Panel>
        )}
        {show("quotas") && (
          <Panel title={t("overview.quotas")} hint={t("overview.quotaScope")}>
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
          </Panel>
        )}
        {show("trend") && (
          <Panel
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
          </Panel>
        )}
        <div className="grid grid-2">
          {show("alerts") && (
            <Panel title={t("overview.alerts")}>
              {data.alerts.length ||
              data.balance < data.account.lowBalanceThresholdUsd ||
              data.month > data.account.budget ||
              data.quotas.some((q) => q.usedValue / q.limitValue >= 0.8) ? (
                <div className="stack">
                  {data.balance < data.account.lowBalanceThresholdUsd && (
                    <Link className="notice warning" to="/billing/bills">
                      {t("billing.lowBalance")}
                    </Link>
                  )}
                  {data.month > data.account.budget && (
                    <Link className="notice warning" to="/billing/cost">
                      {t("billing.overBudget")}
                    </Link>
                  )}
                  {data.alerts.map((alert) => (
                    <div className="notice warning" key={alert.id}>
                      <div className="between">
                        <span>
                          {dt(alert.resource.name)} · {t("common.error")}
                        </span>
                        <Link to={resourceLink(alert.resource)}>
                          <ArrowUpRight size={16} />
                        </Link>
                      </div>
                    </div>
                  ))}
                  {data.quotas
                    .filter((q) => q.usedValue / q.limitValue >= 0.8)
                    .map((q) => (
                      <Link
                        to="/ops/quotas"
                        key={q.region + q.metric}
                        className="notice warning"
                      >
                        {t(`common.${q.region}`)} · {t(`quota.${q.metric}`)}{" "}
                        {number((q.usedValue / q.limitValue) * 100, 1)}%
                      </Link>
                    ))}
                </div>
              ) : (
                <Empty text={t("header.noNotifications")} />
              )}
            </Panel>
          )}
          {show("activity") && (
            <Panel
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
            </Panel>
          )}
        </div>
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
