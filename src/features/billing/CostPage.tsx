import { useUrlState } from "../shared/useUrlState";
import { useState, lazy, Suspense, Fragment } from "react";
import type { Usage, Account, Project } from "../../types/domain";
import { EP, query, patch } from "../../lib/api-client";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canManageOrg } from "../../lib/rbac";
import { useAction, useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { money } from "../../lib/money";
import {
  PageHeader,
  Panel,
  Button,
  Field,
  Loading,
  ErrorState,
  Progress,
} from "../../components/ui";
import { BillingUsageTable } from "./BillingTables";
const TrendChart = lazy(() => import("../../components/charts/TrendChart"));
export default function CostPage() {
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const [period, setPeriod] = useUrlState(
    "billing_period",
    new Date().toISOString().slice(0, 7),
  );
  const [dimension, setDimension] = useState("project");
  const [expanded, setExpanded] = useState("");
  const [budget, setBudget] = useState("");
  const { run, busy } = useAction();
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
  const account = useData<Account>(["account"], EP.account);
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
      <PageHeader
        title={t("nav.cost")}
        subtitle={t("pageDescription.cost")}
      />
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
            <Panel title={t("common.mtd")}>
              <div className="stat-value">{money(summary.data.month)}</div>
              <small>
                {t("common." + region)} · {period}
              </small>
            </Panel>
            <Panel title={t("common.today")}>
              <div className="stat-value">{money(summary.data.today)}</div>
              <small>UTC</small>
            </Panel>
            <Panel title={t("common.budget")}>
              <div className="stat-value">
                {money(account.data?.budget || 0)}
              </div>
              <Progress
                value={(summary.data.month / (account.data?.budget || 1)) * 100}
              />
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
                    <th>{t("common.count")}</th>
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
                        <td>{rows.length}</td>
                      </tr>
                      {expanded === key && (
                        <tr>
                          <td colSpan={3}>
                            <div className="inline-detail">
                              <BillingUsageTable usage={rows} />
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
          <Panel title={t("common.budget")}>
            <div className="row">
              <Field label={t("common.budget") + " · USD"}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={budget || account.data?.budget || ""}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </Field>
              <Button
                disabled={
                  !canManageOrg(role) || !budget || Number(budget) <= 0 || busy
                }
                onClick={() =>
                  void run(() => patch(EP.account, { budget: Number(budget) }))
                }
              >
                {t("billing.setBudget")}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
