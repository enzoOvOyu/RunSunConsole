import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Cpu,
  Layers,
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
  balance: number;
  remainingHours: number | null;
  resources: Resource[];
  regions: { region: string; count: number; gpu: number }[];
  quotas: Quota[];
  trend: Record<string, unknown>[];
  events: ResourceEvent[];
  alerts: { id: string; resource: Resource }[];
  account: Account;
  projects: { id: string; name: string }[];
}
const modules = ["matrix", "quotas", "regions", "trend", "alerts", "activity"];
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
            label: t("overview.running"),
            value: number(data.running),
            note: t("common.current"),
            icon: Layers,
          },
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
        {show("matrix") && (
          <Panel title={t("overview.matrix")} hint={t("overview.matrixScope")}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("common.type")}</th>
                    {["running", "stopped", "provisioning", "error"].map(
                      (status) => (
                        <th key={status}>{t(`common.${status}`)}</th>
                      ),
                    )}
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
                            {t(`common.${kind}`)}
                          </span>
                        </td>
                        {["running", "stopped", "provisioning", "error"].map(
                          (status) => (
                            <td key={status}>
                              <button
                                className="link-button mono"
                                onClick={() =>
                                  navigate(
                                    `/resources/${KIND_META[kind].routeKey}?status=${status}`,
                                  )
                                }
                              >
                                {data.resources.filter(
                                  (r) => r.kind === kind && r.status === status,
                                ).length || "—"}
                              </button>
                            </td>
                          ),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
        {show("quotas") && (
          <Panel title={t("overview.quotas")} hint={t("overview.quotaScope")}>
            <div className="grid grid-4">
              {REGIONS.map((region) => (
                <div key={region}>
                  <h3>
                    {t(`common.${region}`)}{" "}
                    <span className="muted">{region.toUpperCase()}</span>
                  </h3>
                  {data.quotas
                    .filter((q) => q.region === region)
                    .map((quota) => (
                      <div className="quota-line" key={quota.metric}>
                        <div className="between">
                          <small>{t(`quota.${quota.metric}`)}</small>
                          <small className="mono">
                            {number(quota.usedValue)} /{" "}
                            {number(quota.limitValue)}
                          </small>
                        </div>
                        <Progress
                          value={(quota.usedValue / quota.limitValue) * 100}
                        />
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </Panel>
        )}
        {show("regions") && (
          <Panel title={t("overview.regions")} hint={t("overview.regionScope")}>
            <div className="grid grid-4">
              {data.regions.map((region) => (
                <div className="region-card" key={region.region}>
                  <div className="between">
                    <h3>{t(`common.${region.region}`)}</h3>
                    <span className="chip">{region.region.toUpperCase()}</span>
                  </div>
                  <div style={{ margin: "14px 0 6px" }}>
                    <strong className="mono">
                      {region.gpu ? number(region.gpu) : "—"}
                    </strong>{" "}
                    <small>GPU</small>
                  </div>
                  <small>
                    {region.count
                      ? t("common.rows", { count: region.count })
                      : t("overview.noResources")}
                  </small>
                  <div style={{ marginTop: 12 }}>
                    <Progress
                      value={
                        data.allocated ? (region.gpu / data.allocated) * 100 : 0
                      }
                    />
                  </div>
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
                    ? [...KINDS]
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
                    <Link className="notice warning" to="/ops/cost">
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
