import { useUrlState } from "../shared/useUrlState";
import { useMemo, useState, lazy, Suspense, Fragment } from "react";
import type { Usage, Project } from "../../types/domain";
import { EP, query } from "../../lib/api-client";
import { useRegion } from "../../stores/region";
import { useLocale } from "../../stores/locale";
import { useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { money } from "../../lib/money";
import { PageHeader, Panel, Loading, ErrorState } from "../../components/ui";
import { BillingUsageTable } from "./BillingTables";
import { analyzeCostUsage } from "./cost-analysis";
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
export default function CostPage() {
  const region = useRegion((s) => s.region);
  const locale = useLocale((s) => s.locale);
  const [period, setPeriod] = useUrlState(
    "billing_period",
    new Date().toISOString().slice(0, 7),
  );
  const [dimension, setDimension] = useState<
    "project" | "resource" | "region" | "kind"
  >("project");
  const [expanded, setExpanded] = useState("");
  const usage = useData<Usage[]>(
    ["cost-usage", region, period],
    EP.usage + query({ region, billing_period: period }),
  );
  const projects = useData<Project[]>(["projects"], EP.projects);
  const analysis = useMemo(
    () => analyzeCostUsage(usage.data || [], period, dimension),
    [usage.data, period, dimension],
  );
  const currentPeriod = period === new Date().toISOString().slice(0, 7);
  const periodDays = analysis.trend.length || 1;
  return (
    <>
      <PageHeader title={t("nav.cost")} subtitle={t("pageDescription.cost")} />
      <div className="toolbar">
        <RegionFilter />
        <label className="row">
          {t("billing.period")}
          <input
            key={locale}
            className="input"
            type="month"
            lang={locale}
            aria-label={t("billing.period")}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="row">
          {t("billing.dimensions")}
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value as typeof dimension)}
          >
            {["project", "resource", "region", "kind"].map((d) => (
              <option key={d} value={d}>
                {t("billing.dimension." + d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {usage.isPending ? (
        <Loading />
      ) : usage.error ? (
        <ErrorState error={usage.error} />
      ) : (
        <div className="stack">
          <div className="grid grid-3">
            <Panel
              title={t("billing.periodTotal")}
              className="cost-metric-card"
            >
              <div className="stat-value">{money(analysis.month)}</div>
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
                  currentPeriod ? analysis.today : analysis.month / periodDays,
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
              <div className="stat-value">{analysis.resourceCount}</div>
              <small className="cost-metric-note">
                {t("billing.distinctResourceBasis")}
              </small>
            </Panel>
          </div>
          <Panel title={t("overview.trend")}>
            <Suspense fallback={<Loading />}>
              <TrendChart data={analysis.trend} />
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
                  {analysis.groups.map(
                    ({ key, rows, amount, resourceCount }) => (
                      <Fragment key={key}>
                        <tr
                          className="clickable"
                          onClick={() =>
                            setExpanded(expanded === key ? "" : key)
                          }
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
                          <td>{money(amount)}</td>
                          <td>{resourceCount}</td>
                        </tr>
                        {expanded === key && (
                          <tr>
                            <td colSpan={3}>
                              <div className="inline-detail">
                                <BillingUsageTable
                                  usage={rows}
                                  billingPeriod={period}
                                  totalAmount={amount}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
