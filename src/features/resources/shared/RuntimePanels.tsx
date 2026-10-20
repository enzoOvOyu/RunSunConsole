import { useState } from "react";
import type { ResourceOf } from "../../../types/domain";
import type {
  HardwareSnapshot,
  ClusterView,
  ReplicaView,
} from "../../../types/monitoring";
import { EP, query, post } from "../../../lib/api-client";
import { useData, useAction } from "../../shared/hooks";
import { useAuth } from "../../../stores/auth";
import { canWrite } from "../../../lib/rbac";
import { t } from "../../../i18n";
import { number } from "../../../lib/money";
import { duration } from "../../../lib/date";
import {
  Panel,
  DataTable,
  KeyValues,
  Field,
  Modal,
  Button,
  Badge,
  Empty,
  Loading,
  ErrorState,
  Progress,
} from "../../../components/ui";
import { MonitorPanel } from "./common";
export function HardwareHealthPanel({
  resource: r,
  networkOnly = false,
  nodeIndex,
}: {
  resource: ResourceOf<"gpu_baremetal">;
  networkOnly?: boolean;
  nodeIndex?: number;
}) {
  const [localNode, setNode] = useState(0);
  const node = nodeIndex ?? localNode;
  const q = useData<HardwareSnapshot>(
    ["hardware", r.resourceUuid, node],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/hardware${query({ node })}`,
    { poll: true },
  );
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data;
  return (
    <div className="stack">
      {nodeIndex == null && (
        <Field label={t("hardware.machine")}>
          <select
            value={node}
            onChange={(e) => setNode(Number(e.target.value))}
          >
            {Array.from({ length: r.spec.machineCount }, (_, i) => (
              <option key={i} value={i}>
                {r.displayId}-node-{i + 1}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!data.available ? (
        <Empty text={t("common.noData")} />
      ) : (
        <>
          {!networkOnly && (
            <>
              <Panel title={t("hardware.gpuHealth")}>
                <KeyValues
                  items={Object.entries(data.gpuHealth).map(([key, value]) => [
                    t("metric." + key),
                    <span className={value > 0 ? "danger-text" : ""}>
                      {value}
                      {value > 0 ? " ⚠" : ""}
                    </span>,
                  ])}
                />
                {data.gpuHealth.ecc_dbe >= 1 && (
                  <div className="notice warning section-gap">
                    {t("hardware.isolate")}
                  </div>
                )}
              </Panel>
              <Panel title="PCIe">
                <KeyValues
                  items={[
                    [t("metric.pcie_link_gen"), "Gen" + data.pcie.generation],
                    [
                      t("metric.pcie_link_width"),
                      <span
                        className={data.pcie.width < 16 ? "danger-text" : ""}
                      >
                        x{data.pcie.width}
                      </span>,
                    ],
                    [
                      "ACS",
                      data.pcie.acsEnabled
                        ? t("common.enabled")
                        : t("common.disabled"),
                    ],
                    ["AER", data.pcie.aerErrors],
                  ]}
                />
              </Panel>
            </>
          )}
          <Panel title={t("hardware.ibPorts")}>
            <DataTable
              data={data.ibPorts}
              paginate={false}
              columns={[
                { accessorKey: "port", header: "Port" },
                {
                  accessorKey: "state",
                  header: t("common.status"),
                  cell: ({ row }) => <Badge status={row.original.state} />,
                },
                { accessorKey: "rateGbps", header: "Gb/s" },
                { accessorKey: "txGBps", header: "TX · GB/s" },
                { accessorKey: "rxGBps", header: "RX · GB/s" },
                {
                  accessorKey: "symbolErrors",
                  header: t("metric.ib_symbol_errors"),
                },
                {
                  accessorKey: "linkDownEvents",
                  header: t("hardware.linkDown"),
                },
              ]}
            />
          </Panel>
          <Panel title={t("hardware.nvme")}>
            <DataTable
              data={data.disks}
              paginate={false}
              columns={[
                { accessorKey: "name", header: t("common.name") },
                { accessorKey: "capacityGb", header: "GB" },
                { accessorKey: "percentageUsed", header: t("hardware.wear") },
                {
                  accessorKey: "mediaErrors",
                  header: t("hardware.mediaErrors"),
                },
                {
                  accessorKey: "criticalWarning",
                  header: t("hardware.criticalWarning"),
                },
                { accessorKey: "temperatureC", header: "°C" },
                { accessorKey: "raid", header: "RAID" },
              ]}
            />
          </Panel>
          {!networkOnly && (
            <>
              <Panel title={t("hardware.psu")}>
                <p className="notice">
                  {t("hardware.redundancy")} · {data.redundancy}
                </p>
                <DataTable
                  data={data.psus}
                  columns={[
                    { accessorKey: "name", header: t("common.name") },
                    {
                      accessorKey: "status",
                      header: t("common.status"),
                      cell: ({ row }) => <Badge status={row.original.status} />,
                    },
                    { accessorKey: "inputPowerW", header: "W" },
                  ]}
                />
              </Panel>
              <Panel title={t("hardware.cooling")}>
                {data.fans ? (
                  <>
                    <KeyValues
                      items={[[t("hardware.inlet"), `${data.inletC} °C`]]}
                    />
                    <DataTable
                      data={data.fans}
                      columns={[
                        { accessorKey: "name", header: t("common.name") },
                        { accessorKey: "rpm", header: "RPM" },
                        {
                          accessorKey: "status",
                          header: t("common.status"),
                          cell: ({ row }) => (
                            <Badge status={row.original.status} />
                          ),
                        },
                      ]}
                    />
                  </>
                ) : (
                  <div className="notice">{t("hardware.liquid")}</div>
                )}
              </Panel>
              <MonitorPanel
                resource={r}
                nodeIndex={node}
                only={[
                  "gpu_utilization",
                  "gpu_memory_used",
                  "gpu_power_draw",
                  "gpu_temperature",
                  "ecc_dbe",
                  "nvme_temperature",
                ]}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
export function ControlPlanePanel({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  return (
    <div className="stack">
      <Panel title={t("cluster.components")}>
        <DataTable
          data={q.data?.components || []}
          columns={[
            { accessorKey: "name", header: t("common.name") },
            { accessorKey: "ready", header: t("common.ready") },
            { accessorKey: "desired", header: t("cluster.desired") },
          ]}
        />
      </Panel>
      <MonitorPanel
        resource={r}
        only={[
          "apiserver_latency_p99",
          "etcd_fsync_p99",
          "etcd_db_size",
          "scheduler_pending_pods",
          "controller_queue_depth",
          "api_error_rate",
        ]}
      />
    </div>
  );
}
export function NodePoolsPanel({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  const [selected, setSelected] = useState<ClusterView["nodes"][number] | null>(
    null,
  );
  return (
    <div className="stack">
      {r.spec.nodePools.map((p, i) => (
        <Panel key={i} title={p.poolCode}>
          <KeyValues
            items={[
              [t("resource.nodeCount"), p.nodeCount],
              [t("resource.gpu"), p.nodeCount * p.gpuPerNode],
              [t("resource.slicing"), p.slicingPolicy + " · " + p.migProfile],
              [
                t("cluster.autoscaler"),
                t("common." + (q.data?.poolStatus || "pending")),
              ],
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <Progress
              value={
                q.data
                  ? (100 *
                      q.data.nodes
                        .filter((n) => n.poolIndex === i)
                        .reduce((a, n) => a + n.allocatedGpu, 0)) /
                    (p.nodeCount * p.gpuPerNode)
                  : 0
              }
            />
          </div>
        </Panel>
      ))}
      <Panel title={t("cluster.nodes")}>
        <DataTable
          data={q.data?.nodes || []}
          onRow={setSelected}
          columns={[
            { accessorKey: "name", header: t("common.name") },
            {
              accessorKey: "state",
              header: t("common.status"),
              cell: ({ row }) => <Badge status={row.original.state} />,
            },
            { accessorKey: "gpuCount", header: "GPU" },
            { accessorKey: "allocatedGpu", header: t("cluster.gpuAllocated") },
            {
              id: "straggler",
              header: "Straggler",
              cell: ({ row }) =>
                row.original.straggler ? (
                  <span className="danger-text">
                    ⚠ {number(row.original.ratio, 2)}×
                  </span>
                ) : (
                  number(row.original.ratio, 2) + "×"
                ),
            },
          ]}
        />
      </Panel>
      {q.data && (
        <Panel title={t("cluster.plugins")}>
          <KeyValues
            items={[
              ["GPU Operator", q.data.plugins.gpuOperator],
              [
                "Device Plugin",
                q.data.plugins.devicePluginHealthy
                  ? t("common.ready")
                  : t("common.pending"),
              ],
              ["NFD", q.data.plugins.nfdVersion],
              [
                "Driver DaemonSet",
                `${q.data.plugins.driverReady}/${q.data.plugins.driverDesired}`,
              ],
            ]}
          />
        </Panel>
      )}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || t("cluster.nodes")}
      >
        {selected && (
          <KeyValues
            items={Object.entries(selected).map(([key, value]) => [
              key,
              String(value),
            ])}
          />
        )}
      </Modal>
    </div>
  );
}
export function WorkloadsPanel({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data;
  return (
    <div className="stack">
      {data.workloads.map((workload) => (
        <Panel
          key={workload.namespace}
          title={`Namespace · ${workload.namespace}`}
        >
          <details open>
            <summary>
              {workload.deployment} ·{" "}
              {workload.pods.filter((p) => p.phase === "Running").length}{" "}
              Running / {workload.pods.length}
            </summary>
            <div style={{ marginTop: 16 }}>
              <DataTable
                data={workload.pods}
                columns={[
                  { accessorKey: "name", header: "Pod" },
                  {
                    accessorKey: "phase",
                    header: t("common.status"),
                    cell: ({ row }) => (
                      <Badge status={row.original.phase.toLowerCase()} />
                    ),
                  },
                  { accessorKey: "gpuCount", header: "GPU" },
                  { accessorKey: "restarts", header: t("cluster.restarts") },
                  { accessorKey: "oomKilled", header: "OOM" },
                  {
                    accessorKey: "waitingReason",
                    header: t("cluster.waitingReason"),
                  },
                ]}
              />
            </div>
          </details>
        </Panel>
      ))}
      <Panel title={t("cluster.scheduling")}>
        <DataTable
          data={data.scheduling}
          columns={[
            { accessorKey: "reason", header: t("common.reason") },
            { accessorKey: "count", header: t("common.count") },
          ]}
        />
      </Panel>
    </div>
  );
}
export function ClusterNetworkPanel({
  resource: r,
}: {
  resource: ResourceOf<"vgpu">;
}) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  return q.data ? (
    <div className="stack">
      <Panel title={t("tab.network")}>
        <KeyValues
          items={[
            [t("field.networkPlugin"), r.spec.networkPlugin],
            ["CNI errors", q.data.network.cniErrors],
            ["Service P99", q.data.network.serviceP99Ms + " ms"],
            ["Ingress QPS", q.data.network.ingressQps],
            ["VPC peering", t("common." + q.data.network.vpcPeering)],
            [
              "PVC Bound / Pending",
              `${q.data.storage.bound} / ${q.data.storage.pending}`,
            ],
            [t("cluster.pendingReason"), q.data.storage.pendingReason],
            ["PV", q.data.storage.pvCapacityGb + " GB"],
            ["CSI errors", q.data.storage.csiErrors],
          ]}
        />
      </Panel>
    </div>
  ) : q.error ? (
    <ErrorState error={q.error} />
  ) : (
    <Loading />
  );
}
export function ReplicaManagement({
  resource: r,
}: {
  resource: ResourceOf<"inference">;
}) {
  const q = useData<ReplicaView>(
    ["replicas", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/replicas`,
    { poll: true },
  );
  const role = useAuth((s) => s.role);
  const { run, busy } = useAction();
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data;
  return (
    <div className="stack">
      <Panel title={t("inference.hpa")}>
        <KeyValues
          items={[
            [t("inference.actual"), data.actual],
            [t("cluster.desired"), data.desired],
            [t("inference.requests"), number(data.requestCount)],
            [t("inference.success"), number(data.successCount)],
            [t("inference.failed"), number(data.failedCount)],
            [
              t("inference.averageGeneration"),
              `${number(data.averageGenerationLength)} tokens`,
            ],
          ]}
        />
        {data.actual !== data.desired && r.status === "running" && (
          <div className="notice warning section-gap">
            {t("inference.hpaWarning")}
          </div>
        )}
      </Panel>
      <Panel title={t("tab.instances")}>
        <DataTable
          data={data.replicas}
          columns={[
            { accessorKey: "name", header: t("common.name") },
            {
              accessorKey: "phase",
              header: t("common.status"),
              cell: ({ row }) => <Badge status={row.original.phase} />,
            },
            { accessorKey: "node", header: t("cluster.nodes") },
            { accessorKey: "gpuCount", header: "GPU" },
            { accessorKey: "memoryGb", header: "VRAM GB" },
            {
              accessorKey: "rps",
              header: "req/s",
              cell: ({ row }) =>
                row.original.rps == null ? "—" : number(row.original.rps, 2),
            },
            {
              accessorKey: "requestsRunning",
              header: t("metric.num_requests_running"),
              cell: ({ row }) => row.original.requestsRunning ?? "—",
            },
            { accessorKey: "restarts", header: t("cluster.restarts") },
            {
              accessorKey: "uptimeS",
              header: t("resource.uptime"),
              cell: ({ row }) =>
                row.original.uptimeS == null
                  ? "—"
                  : duration(row.original.uptimeS),
            },
            {
              id: "action",
              header: t("common.actions"),
              cell: ({ row }) => (
                <Button
                  disabled={!canWrite(role) || r.status !== "running" || busy}
                  onClick={() =>
                    void run(() =>
                      post(
                        `${EP.resources}/${r.resourceUuid}/restart-replica`,
                        { index: row.index },
                      ),
                    )
                  }
                >
                  {t("resource.restart")}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <p className="notice">{t("price.inferenceNote")}</p>
    </div>
  );
}
