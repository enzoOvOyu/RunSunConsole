import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import type { Pipeline, PipelineNode, PipelineRun } from "../../types/domain";
import { EP, query, post, patch, remove } from "../../lib/api-client";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData, useDebounced } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { date, duration } from "../../lib/date";
import {
  PageHeader,
  Button,
  Panel,
  Modal,
  Field,
  DataTable,
  KeyValues,
  Badge,
  Empty,
  Loading,
  ErrorState,
} from "../../components/ui";
export default function PipelinesPage() {
  const role = useAuth((s) => s.role);
  const { id, setId } = useDrawer();
  const [search, setSearch] = useUrlState("q");
  const qtext = useDebounced(search);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [node, setNode] = useState<PipelineNode | null>(null);
  const [runId, setRunId] = useState("");
  const [level, setLevel] = useState("");
  const q = useData<Pipeline[]>(
    ["pipelines", qtext],
    EP.pipelines + query({ q: qtext }),
  );
  const detail = useData<Pipeline>(["pipeline", id], `${EP.pipelines}/${id}`, {
    enabled: !!id,
    poll: true,
  });
  const runDetail = useData<{ run: PipelineRun; nodes: PipelineNode[] }>(
    ["pipeline-run", runId],
    `${EP.pipelineRuns}/${runId}/nodes`,
    { enabled: !!runId, poll: true },
  );
  const { run, busy } = useAction();
  const p = detail.data;
  return (
    <>
      <PageHeader
        title={t("nav.pipelines")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setNewOpen(true)}
          >
            {t("pipelines.new")}
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
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={q.data || []}
            onRow={(p) => setId(p.id)}
            columns={[
              {
                accessorKey: "name",
                header: t("common.name"),
                cell: ({ row }) => dt(row.original.name),
              },
              {
                id: "nodes",
                header: t("resource.nodeCount"),
                cell: ({ row }) => row.original.nodes.length,
              },
              {
                id: "status",
                header: t("common.status"),
                cell: ({ row }) => (
                  <Badge status={row.original.runs[0]?.status || "pending"} />
                ),
              },
              {
                id: "lastRun",
                header: t("pipelines.history"),
                cell: ({ row }) =>
                  row.original.runs[0]
                    ? date(row.original.runs[0].startedAt)
                    : "—",
              },
              {
                id: "average",
                header: t("common.duration"),
                cell: ({ row }) =>
                  row.original.runs.length
                    ? duration(
                        row.original.runs.reduce((a, r) => a + r.durationS, 0) /
                          row.original.runs.length,
                      )
                    : "—",
              },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
            ]}
          />
        )}
      </div>
      <Modal
        drawer
        open={!!id}
        onClose={() => setId("")}
        title={p ? dt(p.name) : t("nav.pipelines")}
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState error={detail.error} />
        ) : p ? (
          <div className="stack">
            <div className="row">
              <Button
                variant="primary"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  const result = await run(
                    () => post<PipelineRun>(`${EP.pipelines}/${id}/runs`, {}),
                    "success.created",
                  );
                  if (result) setRunId(result.id);
                }}
              >
                {t("pipelines.run")}
              </Button>
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      t("common.delete") + " " + dt(p.name),
                    ))
                  )
                    return;
                  const ok = await run(async () => {
                    await remove(`${EP.pipelines}/${id}`);
                    return true;
                  });
                  if (ok) setId("");
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
            <DagCanvas
              pipeline={p}
              onNode={(node) => setNode(structuredClone(node))}
            />
            <Panel title={t("pipelines.history")}>
              <DataTable
                data={p.runs}
                onRow={(r) => setRunId(r.id)}
                columns={[
                  {
                    accessorKey: "startedAt",
                    header: t("common.time"),
                    cell: ({ row }) => date(row.original.startedAt),
                  },
                  { accessorKey: "actor", header: t("common.actor") },
                  {
                    accessorKey: "status",
                    header: t("common.status"),
                    cell: ({ row }) => <Badge status={row.original.status} />,
                  },
                  {
                    accessorKey: "durationS",
                    header: t("common.duration"),
                    cell: ({ row }) => duration(row.original.durationS),
                  },
                ]}
              />
            </Panel>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={t("pipelines.new")}
      >
        <div className="stack">
          <Field label={t("common.name")}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <p className="notice">Parquet → MinHash → Tokenize → S3</p>
          <Button
            variant="primary"
            disabled={!canWrite(role) || name.length < 2 || busy}
            onClick={async () => {
              const p = await run(
                () => post<Pipeline>(EP.pipelines, { name }),
                "success.created",
              );
              if (p) {
                setNewOpen(false);
                setId(p.id);
              }
            }}
          >
            {t("common.create")}
          </Button>
        </div>
      </Modal>
      <Modal
        small
        open={!!node}
        onClose={() => setNode(null)}
        title={t("pipelines.nodeConfig")}
      >
        {node && (
          <div className="stack">
            <KeyValues
              items={[
                [t("common.name"), node.name],
                [t("common.type"), t("pipelines." + node.type)],
                [t("pipelines.inputs"), node.inputs.join(", ") || "dataset"],
              ]}
            />
            {Object.entries(node.parameters).map(([key, value]) => (
              <Field key={key} label={key}>
                <input
                  className="input"
                  value={String(value)}
                  disabled={!canWrite(role)}
                  onChange={(e) =>
                    setNode({
                      ...node,
                      parameters: {
                        ...node.parameters,
                        [key]:
                          typeof value === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))}
            <Button
              disabled={!canWrite(role) || busy || !p}
              onClick={async () => {
                if (!p) return;
                const updated = p.nodes.map((n) =>
                  n.id === node.id ? node : n,
                );
                const result = await run(() =>
                  patch(`${EP.pipelines}/${id}`, { nodes: updated }),
                );
                if (result) setNode(null);
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        small
        open={!!runId}
        onClose={() => setRunId("")}
        title={t("pipelines.history")}
      >
        {runDetail.isPending ? (
          <Loading />
        ) : runDetail.error ? (
          <ErrorState error={runDetail.error} />
        ) : runDetail.data ? (
          <div className="stack">
            <Badge status={runDetail.data.run.status} />
            <KeyValues
              items={[
                [t("common.time"), date(runDetail.data.run.startedAt)],
                [t("common.actor"), runDetail.data.run.actor],
                [t("common.duration"), duration(runDetail.data.run.durationS)],
              ]}
            />
            <Field label={t("common.filter")}>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">{t("common.all")}</option>
                {["info", "warning", "error"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            {runDetail.data.nodes.map((n) => (
              <Panel key={n.id} title={n.name}>
                <div className="stack">
                  <KeyValues
                    items={[
                      [t("pipelines.inputs"), n.inputs.join(", ") || "dataset"],
                      ...Object.entries(n.parameters),
                    ]}
                  />
                  {runDetail
                    .data!.run.nodeLogs.filter(
                      (l) => l.nodeId === n.id && (!level || l.level === level),
                    )
                    .map((log, i) => (
                      <pre
                        key={i}
                        className={log.level === "error" ? "danger-text" : ""}
                      >
                        {log.at} [{log.level}] {log.message}
                      </pre>
                    ))}
                </div>
              </Panel>
            ))}
            <Panel title={t("pipelines.artifacts")}>
              {runDetail.data.run.artifacts.length ? (
                runDetail.data.run.artifacts.map((a) => (
                  <div key={a}>
                    <Link to="/data/storage?drawer=bucket-jp">{a}</Link>
                  </div>
                ))
              ) : (
                <Empty />
              )}
            </Panel>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
function DagCanvas({
  pipeline: p,
  onNode,
}: {
  pipeline: Pipeline;
  onNode: (node: PipelineNode) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    ox: number;
    oy: number;
  } | null>(null);
  const handleDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y });
  };
  const nodes = p.nodes;
  const position = (i: number) => ({
    x: 30 + (i % 3) * 260,
    y: 50 + Math.floor(i / 3) * 140,
  });
  return (
    <div className="stack">
      <div className="row">
        <Button
          onClick={() => setScale(Math.min(2, scale + 0.15))}
          aria-label={t("pipelines.zoomIn")}
        >
          +
        </Button>
        <Button
          onClick={() => setScale(Math.max(0.4, scale - 0.15))}
          aria-label={t("pipelines.zoomOut")}
        >
          −
        </Button>
        <small>{Math.round(scale * 100)}%</small>
        <Button
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
        >
          {t("common.reset")}
        </Button>
      </div>
      <div
        className="dag-canvas"
        onPointerDown={handleDown}
        onPointerMove={(e) => {
          if (drag)
            setOffset({
              x: drag.ox + e.clientX - drag.x,
              y: drag.oy + e.clientY - drag.y,
            });
        }}
        onPointerUp={() => setDrag(null)}
      >
        <svg viewBox="0 0 850 340" aria-label={t("nav.pipelines")}>
          <defs>
            <marker
              id="dag-arrow"
              markerWidth={7}
              markerHeight={7}
              refX={6}
              refY={3}
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6" fill="var(--rs-text-muted)" />
            </marker>
          </defs>
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {nodes.flatMap((n, i) =>
              n.inputs.map((input) => {
                const from = position(
                  nodes.findIndex((node) => node.id === input),
                );
                const to = position(i);
                return (
                  <path
                    key={input + n.id}
                    d={`M${from.x + 190},${from.y + 35} C${from.x + 220},${from.y + 35} ${to.x - 35},${to.y + 35} ${to.x},${to.y + 35}`}
                    fill="none"
                    stroke="var(--rs-text-muted)"
                    strokeWidth={1.3}
                    markerEnd="url(#dag-arrow)"
                  />
                );
              }),
            )}
            {nodes.map((n, i) => {
              const { x, y } = position(i);
              return (
                <g
                  key={n.id}
                  data-node="true"
                  role="button"
                  tabIndex={0}
                  aria-label={n.name}
                  onClick={() => onNode(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onNode(n);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={190}
                    height={70}
                    rx={8}
                    fill="var(--rs-bg)"
                    stroke="var(--rs-border)"
                  />
                  <rect
                    x={x}
                    y={y}
                    width={4}
                    height={70}
                    rx={2}
                    fill={
                      [
                        "var(--rs-info)",
                        "var(--rs-brand)",
                        "var(--rs-purple)",
                        "var(--rs-success)",
                      ][i % 4]
                    }
                  />
                  <text
                    x={x + 16}
                    y={y + 29}
                    fill="var(--rs-text)"
                    fontSize={13}
                  >
                    {n.name}
                  </text>
                  <text
                    x={x + 16}
                    y={y + 50}
                    fill="var(--rs-text-secondary)"
                    fontSize={11}
                  >
                    {t("pipelines." + n.type)} ·{" "}
                    {t("common." + (p.runs[0]?.status || "pending"))}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
