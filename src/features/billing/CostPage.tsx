import { useUrlState } from "../shared/useUrlState";
import { useState, lazy, Suspense, Fragment } from "react";
import type { Usage, Project } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { useRegion } from "../../stores/region";
import { useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { money } from "../../lib/money";
import { PageHeader, Panel, Loading, ErrorState } from "../../components/ui";
import { BillingUsageTable } from "./BillingTables";
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
export default function CostPage() {
  const region = useRegion((s) => s.region);
  const [period, setPeriod] = useUrlState(
    "billing_period",
    new Date().toISOString().slice(0, 7),
  );
  const [dimension, setDimension] = useState("project");
  const [expanded, setExpanded] = useState("");
  const summary = useData<{
    month: number;
    today: number;
    trend: Record<string, unknown>[];
  }>(
    ["cost-summary", region, period],
    EP.summary + query({ region, billing_period: period }),
  );
  const usage = useData<Usage[]>(
    ["cost-usage", region, period],
    EP.usage + query({ region, billing_period: period }),
  );
  const projects = useData<Project[]>(["projects"], EP.projects);
  const resourceCount = new Set(
    (usage.data || []).map((row) => row.resourceUuid).filter(Boolean),
  ).size;
  const currentPeriod = period === new Date().toISOString().slice(0, 7);
  const periodDays = (() => {
    const [year, month] = period.split("-").map(Number);
    return year && month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 1;
  })();
  const groups = new Map<string, Usage[]>();
  for (const u of usage.data || []) {
    const key =
      dimension === "project"
        ? u.projectId
        : dimension === "resource"
          ? u.displayId
          : dimension === "region"
            ? u.region
            : u.kind;
    groups.set(key, [...(groups.get(key) || []), u]);
  }
  return (
    <>
      <PageHeader title={t("nav.cost")} subtitle={t("pageDescription.cost")} />
      <div className="toolbar">
        <RegionFilter />
        <label className="row">
          {t("billing.period")}
          <input
            className="input"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="row">
          {t("billing.dimensions")}
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value)}
          >
            {["project", "resource", "region", "kind"].map((d) => (
              <option key={d} value={d}>
                {t("billing.dimension." + d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} />
      ) : (
        <div className="stack">
          <div className="grid grid-3">
            <Panel
              title={t("billing.periodTotal")}
              className="cost-metric-card"
            >
              <div className="stat-value">{money(summary.data.month)}</div>
              <small className="cost-metric-note">
                {t("common." + region)} · {period}
              </small>
            </Panel>
            <Panel
              title={t(currentPeriod ? "common.today" : "billing.dailyAverage")}
              className="cost-metric-card"
            >
              <div className="stat-value">
                {money(
                  currentPeriod
                    ? summary.data.today
                    : summary.data.month / periodDays,
                )}
              </div>
              <small className="cost-metric-note">
                {currentPeriod ? t("billing.todayBasis") : period}
              </small>
            </Panel>
            <Panel
              title={t("billing.resourceCount")}
              className="cost-metric-card"
            >
              <div className="stat-value">{resourceCount}</div>
              <small className="cost-metric-note">
                {t("billing.distinctResourceBasis")}
              </small>
            </Panel>
          </div>
          <Panel title={t("overview.trend")}>
            <Suspense fallback={<Loading />}>
              <TrendChart data={summary.data.trend} />
            </Suspense>
          </Panel>
          <Panel title={t("billing.dimensions")}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("billing.dimension." + dimension)}</th>
                    <th>{t("common.amount")}</th>
                    <th>{t("billing.resourceCount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...groups].map(([key, rows]) => (
                    <Fragment key={key}>
                      <tr
                        className="clickable"
                        onClick={() => setExpanded(expanded === key ? "" : key)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            setExpanded(expanded === key ? "" : key);
                        }}
                      >
                        <td>
                          {dimension === "project"
                            ? dt(
                                projects.data?.find((p) => p.id === key)
                                  ?.name || key,
                              )
                            : dimension === "region" || dimension === "kind"
                              ? t("common." + key)
                              : key}
                        </td>
                        <td>{money(rows.reduce((a, u) => a + u.amount, 0))}</td>
                        <td>
                          {
                            new Set(
                              rows
                                .map((row) => row.resourceUuid)
                                .filter(Boolean),
                            ).size
                          }
                        </td>
                      </tr>
                      {expanded === key && (
                        <tr>
                          <td colSpan={3}>
                            <div className="inline-detail">
                              <BillingUsageTable
                                usage={rows}
                                billingPeriod={period}
                                region={region}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
