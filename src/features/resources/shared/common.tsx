import { formatReferenceId, formatResourceId } from "../../../lib/ids";
import { lazy, memo, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Resource,
  MetricSeries,
  Usage,
  Transaction,
  PriceEstimate,
  Order,
  ScalingPolicy,
  ScalingEvent,
} from "../../../types/domain";
import { t, dt } from "../../../i18n";
import { useLocale } from "../../../stores/locale";
import { EP, query } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { money, number, unitMoney } from "../../../lib/money";
import { poolDisplayName } from "../../../lib/gpu-labels";
import { date, duration } from "../../../lib/date";
import {
  Button,
  Panel,
  Empty,
  Loading,
  ErrorState,
  DataTable,
  KeyValues,
  Progress,
  EventTimeline,
  CopyButton,
  Badge,
  download,
  csv,
} from "../../../components/ui";
import type { ResourceEvent } from "../../../types/domain";
const TrendChart = lazy(() => import("../../../components/charts/TrendChart"));
const MONITOR_PAGE_SIZE = 6;
const MONITOR_POLL_MS: Record<string, number> = {
  "1h": 10000,
  "6h": 60000,
  "24h": 300000,
  "7d": 3600000,
};
const MetricCard = memo(function MetricCard({
  series,
}: {
  series: MetricSeries;
}) {
  useLocale((state) => state.locale);
  const lastPoint = series.points.at(-1);
  const last = lastPoint?.value;
  const lastTime = lastPoint ? new Date(lastPoint.at).getTime() : 0;
  const recent =
    series.comparison === "below" && series.threshold != null
      ? series.points.filter(
          (point) => new Date(point.at).getTime() >= lastTime - 1800000,
        )
      : [];
  const sustained =
    recent.length > 1 &&
    new Date(recent[0].at).getTime() <= lastTime - 1740000 &&
    recent.every(
      (point) => point.value !== null && point.value < series.threshold!,
    );
  const warning =
    last != null &&
    series.threshold != null &&
    (series.comparison === "below" ? sustained : last >= series.threshold);
  const [key, card] = series.key.split(":");
  return (
    <Panel title={t("metric." + key) + (card ? ` · GPU ${card}` : "")}>
      <div className="between">
        <strong style={{ fontSize: 24, fontWeight: 600 }}>
          {last == null
            ? t("common.noData")
            : `${number(last, key.startsWith("http_error") || key === "api_error_rate" ? 3 : 1)}${series.capacity ? " / " + series.capacity : ""} ${series.unit}`}
        </strong>
        <span className={warning ? "danger-text" : "muted"}>
          {series.threshold == null
            ? "—"
            : `${last == null ? "—" : warning ? "⚠" : "✓"} ${t("metric.threshold")} ${series.comparison === "below" ? "<" : "≥"} ${number(series.threshold, 1)} ${series.unit}`}
        </span>
      </div>
      {series.comparison === "below" && (
        <small>{t("metric.lowDuration")}</small>
      )}
      <Suspense fallback={<Loading />}>
        <TrendChart
          data={series.points.map((point) => ({
            date: point.at,
            value: point.value,
          }))}
          keys={["value"]}
          currency={false}
        />
      </Suspense>
    </Panel>
  );
});
export function MonitorPanel({
  resource: r,
  only,
  nodeIndex,
}: {
  resource: Resource;
  only?: string[];
  nodeIndex?: number;
}) {
  const [window, setWindow] = useState("1h");
  const [page, setPage] = useState(0);
  const catalog = useData<MetricSeries[]>(
    ["metric-catalog", r.resourceUuid, nodeIndex],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}${query({ catalog: true, node: nodeIndex })}`,
    { enabled: !only },
  );
  const keys = only || catalog.data?.map((series) => series.key) || [];
  const pageCount = Math.ceil(keys.length / MONITOR_PAGE_SIZE);
  const activePage = Math.min(page, Math.max(0, pageCount - 1));
  const names = keys
    .slice(activePage * MONITOR_PAGE_SIZE, (activePage + 1) * MONITOR_PAGE_SIZE)
    .join(",");
  const data = useData<MetricSeries[]>(
    ["metrics", r.resourceUuid, window, names, nodeIndex],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}${query({ window, metrics: names, node: nodeIndex })}`,
    { enabled: !!names, poll: true, pollMs: MONITOR_POLL_MS[window] },
  );
  const processes = useData<
    {
      pid: number;
      command: string;
      gpu: number;
      memoryMiB: number;
      user: string;
      startedAt: string;
    }[]
  >(
    ["processes", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/processes`,
    { enabled: r.kind === "gpu_vm", poll: true, pollMs: 10000 },
  );
  return (
    <div className="stack">
      <div className="row">
        {["1h", "6h", "24h", "7d"].map((w) => (
          <Button
            key={w}
            variant={w === window ? "primary" : "default"}
            onClick={() => setWindow(w)}
          >
            {w}
          </Button>
        ))}
      </div>
      {catalog.isPending && !only ? (
        <Loading />
      ) : catalog.error && !only ? (
        <ErrorState error={catalog.error} />
      ) : (
        <>
          {pageCount > 1 && (
            <div className="between">
              <span className="muted">
                {t("metric.pageSummary", {
                  page: activePage + 1,
                  total: pageCount,
                })}
              </span>
              <div className="row">
                <Button
                  disabled={activePage === 0}
                  onClick={() => setPage(activePage - 1)}
                >
                  {t("metric.previousPage")}
                </Button>
                <Button
                  disabled={activePage >= pageCount - 1}
                  onClick={() => setPage(activePage + 1)}
                >
                  {t("metric.nextPage")}
                </Button>
              </div>
            </div>
          )}
          {data.isPending ? (
            <Loading />
          ) : data.error ? (
            <ErrorState error={data.error} />
          ) : (
            <div className="grid grid-2">
              {data.data?.map((series) => (
                <MetricCard key={series.key} series={series} />
              ))}
            </div>
          )}
        </>
      )}
      {r.kind === "gpu_vm" && (
        <Panel title={t("metric.processes")}>
          <DataTable
            data={processes.data || []}
            columns={[
              { accessorKey: "pid", header: "PID" },
              { accessorKey: "command", header: t("metric.command") },
              { accessorKey: "gpu", header: "GPU" },
              { accessorKey: "memoryMiB", header: "VRAM · MiB" },
              { accessorKey: "user", header: t("common.actor") },
              {
                accessorKey: "startedAt",
                header: t("common.time"),
                cell: ({ row }) => date(row.original.startedAt),
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
export function MetricsOverview({ resource: r }: { resource: Resource }) {
  const data = useData<MetricSeries[]>(
    ["metrics-overview", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}?window=1h&metrics=gpu_utilization,gpu_memory_used,gpu_power_draw,gpu_temperature&latest=true`,
    { poll: true, pollMs: 10000 },
  );
  return (
    <div className="grid grid-4">
      {data.data?.slice(0, 4).map((s) => (
        <div className="panel stat" key={s.key}>
          <small>{t(`metric.${s.key}`)}</small>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {s.points.at(-1)?.value != null
              ? `${number(s.points.at(-1)!.value!, 1)}${s.capacity ? " / " + s.capacity : ""} ${s.unit}`
              : "—"}
          </div>
          <small>
            {s.points.at(-1)?.value == null
              ? t("common.noData")
              : t("metric.healthy")}
          </small>
        </div>
      ))}
    </div>
  );
}
export function EventsPanel({ resource: r }: { resource: Resource }) {
  const events = useData<ResourceEvent[]>(
    ["events", r.resourceUuid],
    EP.events + query({ resource_id: r.resourceUuid }),
    { poll: true },
  );
  return events.isPending ? (
    <Loading />
  ) : (
    <EventTimeline
      events={(events.data || []).map((e) => ({
        ...e,
        reason:
          e.type === "NODE_CORDONED"
            ? t("cluster.nodeCordonedEvent", { node: e.reason })
            : e.type === "NODE_UNCORDONED"
              ? t("cluster.nodeUncordonedEvent", { node: e.reason })
              : e.type === "NODE_POOL_RESIZED"
                ? t("cluster.nodePoolResizedEvent", {
                    pool: poolDisplayName(e.reason),
                    before: e.before,
                    after: e.after,
                  })
                : dt(e.reason),
        action:
          e.action === "NODE_CORDONED"
            ? t("cluster.nodeCordonedAction")
            : e.action === "NODE_UNCORDONED"
              ? t("cluster.nodeUncordonedAction")
              : e.action === "NODE_POOL_RESIZED"
                ? t("cluster.nodePoolResizedAction")
                : dt(e.action),
      }))}
    />
  );
}
export function BillingPanel({ resource: r }: { resource: Resource }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const usage = useData<Usage[]>(
    ["usage", r.resourceUuid, month],
    EP.usage + query({ resource_id: r.resourceUuid, billing_period: month }),
    { poll: true },
  );
  const tx = useData<Transaction[]>(
    ["transactions", r.resourceUuid, month],
    EP.transactions +
      query({ resource_id: r.resourceUuid, billing_period: month }),
  );
  const price = useData<{ order: Order }>(
    ["resource-order", r.resourceUuid],
    EP.resources + "/" + r.resourceUuid,
    { enabled: !r.deletedAt },
  );
  const current = useData<{
    hourly: number;
    today: number;
    month: number;
    total: number;
    remainingHours: number | null;
    estimate: PriceEstimate;
  }>(
    ["resource-billing", r.resourceUuid, month],
    EP.summary + query({ resource_id: r.resourceUuid, billing_period: month }),
    { poll: true },
  );
  const total = current.data?.month || 0;
  const today = current.data?.today || 0;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const shown =
    usage.data?.filter(
      (u) =>
        (!from || u.usageHour >= from) &&
        (!to || u.usageHour.slice(0, 10) <= to),
    ) || [];
  return (
    <div className="stack">
      <div className="toolbar">
        <label className="row">
          {t("billing.period")}
          <input
            type="month"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      {r.status === "stopped" && (
        <div className="notice warning">{t("price.stopped")}</div>
      )}
      {r.status === "provisioning" && (
        <div className="notice">{t("price.provisioning")}</div>
      )}
      {r.kind === "inference" && (
        <div className="notice">{t("price.inferenceNote")}</div>
      )}
      <Panel title={t("common.cost")}>
        <KeyValues
          items={[
            [
              t("resource.hourly"),
              current.data ? money(current.data.hourly) : "—",
            ],
            [
              t("price.lifetime"),
              current.data ? money(current.data.total) : "—",
            ],
            [
              t("common.runtime"),
              current.data?.remainingHours
                ? number(current.data.remainingHours, 1) + "h"
                : "—",
            ],
          ]}
        />
        <div className="grid grid-3">
          <div>
            <small>{t("common.today")}</small>
            <div className="stat-value" style={{ fontSize: 24 }}>
              {r.status === "provisioning" ? "—" : money(today)}
            </div>
          </div>
          <div>
            <small>{t("common.mtd")}</small>
            <div className="stat-value" style={{ fontSize: 24 }}>
              {money(total)}
            </div>
          </div>
          <div>
            <small>{t("price.orderEstimate")}</small>
            <div className="stat-value" style={{ fontSize: 24 }}>
              {price.data?.order
                ? money(price.data.order.price_snapshot.hourly)
                : "—"}
              <small>{t("common.perHour")}</small>
            </div>
          </div>
        </div>
      </Panel>
      <Panel title={t("price.breakdown")}>
        <KeyValues
          items={(current.data?.estimate?.lines || []).map((line) => [
            t(`price.${line.key.split(":")[0]}`) +
              (line.key.includes(":") ? " " + line.key.split(":")[1] : ""),
            `${line.quantity} × ${unitMoney(line.unitPrice)} / ${t("unit." + line.unit)} = ${money(line.hourly)}/h`,
          ])}
        />
      </Panel>
      <Panel
        title={t("common.usage")}
        action={
          <Button
            onClick={() =>
              csv(
                `${r.displayId}-usage.csv`,
                shown as unknown as Record<string, unknown>[],
              )
            }
          >
            {t("common.export")}
          </Button>
        }
      >
        <div className="toolbar">
          <input
            type="date"
            aria-label={t("common.before")}
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            aria-label={t("common.after")}
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <DataTable
          data={shown}
          columns={[
            {
              accessorKey: "usageHour",
              header: t("common.time"),
              cell: ({ row }) => date(row.original.usageHour),
            },
            {
              accessorKey: "unit",
              header: t("common.unit"),
              cell: ({ row }) => t("unit." + row.original.unit),
            },
            {
              accessorKey: "quantity",
              header: t("common.count"),
              cell: ({ row }) => number(row.original.quantity, 4),
            },
            {
              accessorKey: "unitPrice",
              header: t("common.price"),
              cell: ({ row }) => unitMoney(row.original.unitPrice),
            },
            {
              accessorKey: "amount",
              header: t("common.amount"),
              cell: ({ row }) => money(row.original.amount),
            },
            {
              accessorKey: "status",
              header: t("common.status"),
              cell: ({ row }) => <Badge status={row.original.status} />,
            },
          ]}
        />
      </Panel>
      <Panel title={t("common.transactions")}>
        <TransactionTable rows={tx.data || []} />
      </Panel>
    </div>
  );
}
export function TransactionTable({ rows }: { rows: Transaction[] }) {
  return (
    <DataTable
      data={rows}
      columns={[
        {
          accessorKey: "id",
          header: "ID",
          cell: ({ row }) => formatResourceId("txn", row.original.id),
        },
        {
          accessorKey: "at",
          header: t("common.time"),
          cell: ({ row }) => date(row.original.at),
        },
        {
          accessorKey: "type",
          header: t("common.type"),
          cell: ({ row }) => t("billing." + row.original.type),
        },
        {
          accessorKey: "amount",
          header: t("common.amount"),
          cell: ({ row }) => money(row.original.amount),
        },
        {
          accessorKey: "balanceAfter",
          header: t("billing.balanceAfter"),
          cell: ({ row }) => money(row.original.balanceAfter),
        },
        {
          accessorKey: "referenceId",
          header: t("billing.reference"),
          cell: ({ row }) => formatReferenceId(row.original.referenceId),
        },
      ]}
    />
  );
}
export function ScalingReadonly({ resource: r }: { resource: Resource }) {
  const data = useData<ScalingPolicy[]>(
    ["policies", r.resourceUuid],
    EP.policies + query({ resource_id: r.resourceUuid }),
  );
  const events = useData<ScalingEvent[]>(
    ["scaling-events", r.resourceUuid],
    EP.scalingEvents + query({ resource_id: r.resourceUuid }),
  );
  return (
    <div className="stack">
      <div className="notice">
        {t("resource.scaleReadonly")} ·{" "}
        <Link to="/workbench/scaling">{t("nav.scaling")}</Link>
      </div>
      {data.data?.length ? (
        data.data.map((p) => (
          <Panel key={p.id} title={p.name}>
            <KeyValues
              items={[
                [t("common.status"), <Badge status={p.status} />],
                [t("common.type"), t("scaling." + p.config.strategy_model)],
                [t("common.metric"), t("scaling." + p.config.trigger_metric)],
                [t("common.target"), p.config.target_value],
                [t("common.min"), p.config.min_size],
                [t("common.max"), p.config.max_size],
              ]}
            />
          </Panel>
        ))
      ) : (
        <Empty />
      )}
      <Panel title={t("scaling.events")}>
        <DataTable
          data={events.data || []}
          columns={[
            {
              accessorKey: "at",
              header: t("common.time"),
              cell: ({ row }) => date(row.original.at),
            },
            {
              accessorKey: "direction",
              header: t("common.type"),
              cell: ({ row }) => t("scaling." + row.original.direction),
            },
            {
              id: "change",
              header: t("common.count"),
              cell: ({ row }) => `${row.original.from} → ${row.original.to}`,
            },
            { accessorKey: "value", header: t("common.metric") },
            { accessorKey: "durationS", header: t("common.duration") },
          ]}
        />
      </Panel>
    </div>
  );
}
export function AccessPanel({
  resource: r,
  mode = "console",
}: {
  resource: Resource;
  mode?: "console" | "bmc" | "firmware";
}) {
  const data = useData<{
    privateIp: string;
    ssh: string;
    endpoint: string;
    bmc: { ip: string; firmware: string; reachable: boolean };
    driver: string;
    cuda: string;
    vbios: string;
    compliance: boolean;
  }>(["access", r.resourceUuid], `${EP.resources}/${r.resourceUuid}/access`, {
    enabled: r.status === "running" && !r.deletedAt,
  });
  if (r.status !== "running") return <Empty text={t("resource.startToUse")} />;
  if (data.isPending) return <Loading />;
  if (data.error) return <ErrorState error={data.error} />;
  const a = data.data;
  return (
    <div className="stack">
      {mode === "console" ? (
        <>
          <Panel title="SSH">
            <pre>{a.ssh}</pre>
            <CopyButton value={a.ssh} />
          </Panel>
          <div className="grid grid-3">
            {["JupyterLab", "Web Terminal", "File Manager"].map((name) => (
              <Panel title={name} key={name}>
                <p>{t("resource.connectionNote")}</p>
                <code>{a.privateIp}</code>
                <CopyButton
                  value={`${a.endpoint}/${name.toLowerCase().replaceAll(" ", "-")}`}
                />
              </Panel>
            ))}
          </div>
        </>
      ) : mode === "bmc" ? (
        <Panel title="BMC / IPMI">
          <KeyValues
            items={[
              [t("common.endpoint"), a.bmc.ip],
              ["Firmware", a.bmc.firmware],
              [
                t("common.status"),
                a.bmc.reachable ? t("common.ready") : t("common.error"),
              ],
              ["SEL", t("common.noData")],
            ]}
          />
        </Panel>
      ) : (
        <Panel title={t("tab.firmware")}>
          <KeyValues
            items={[
              ["VBIOS", a.vbios],
              ["NVIDIA Driver", a.driver],
              ["CUDA", a.cuda],
              ["Compliance", a.compliance ? "✓" : "⚠"],
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
export function SpecPanel({ resource: r }: { resource: Resource }) {
  return (
    <Panel title={t("resource.config")}>
      <KeyValues
        items={Object.entries(r.spec)
          .filter(([, v]) => typeof v !== "object")
          .map(([key, value]) => [
            t("field." + key),
            typeof value === "boolean"
              ? t(value ? "common.enabled" : "common.disabled")
              : String(value),
          ])}
      />
    </Panel>
  );
}
export function Provisioning({ resource: r }: { resource: Resource }) {
  const steps = useData<
    {
      name: string;
      status: string;
      durationS?: number;
      etaS?: number;
      overallProgress?: number;
    }[]
  >(["steps", r.resourceUuid], `${EP.resources}/${r.resourceUuid}/steps`, {
    poll: r.status === "provisioning",
  });
  return r.status === "provisioning" ? (
    <Panel title={t("resource.provisionSteps")}>
      <p className="muted">
        {t("provisioning.eta")} ·{" "}
        {steps.data?.at(-1)?.etaS != null
          ? duration(steps.data.at(-1)!.etaS!)
          : "—"}
      </p>
      <Progress
        value={
          steps.data?.[0]?.overallProgress ??
          ((steps.data?.filter((s) => s.status === "success").length || 0) /
            (steps.data?.length || 1)) *
            100
        }
      />
      <div className="row" style={{ marginTop: 12 }}>
        {steps.data?.map((s) => (
          <span className="chip" key={s.name}>
            {s.status === "success" ? (
              "✓"
            ) : s.status === "in_progress" ? (
              <span
                className="status-light"
                aria-label={t("common.provisioning")}
              />
            ) : (
              "○"
            )}{" "}
            {t("provisioning." + s.name)}
          </span>
        ))}
      </div>
    </Panel>
  ) : null;
}
export function Kubeconfig({ resource: r }: { resource: Resource }) {
  return (
    <Button
      disabled={r.status !== "running"}
      onClick={() =>
        download(
          `${r.displayId}-kubeconfig.yaml`,
          `apiVersion: v1\nkind: Config\nclusters:\n  - name: ${r.displayId}\n    cluster:\n      server: https://${r.displayId}.${r.region}.runsun.cloud\ncontexts: []\nusers: []\n`,
        )
      }
    >
      {t("eks.kubeconfigDemo")}
    </Button>
  );
}
