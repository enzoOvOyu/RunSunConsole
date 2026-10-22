import { poolDisplayName } from "../../../lib/gpu-labels";
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
import { number, money } from "../../../lib/money";
import type { Rate } from "../../../types/domain";
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
  const [selected, setSelected] = useState<ClusterView["nodes"][number] | null>(null);
  const [resizePool, setResizePool] = useState<number | null>(null);
  const [targetNodes, setTargetNodes] = useState(1);
  const [minNodes, setMinNodes] = useState(1);
  const [maxNodes, setMaxNodes] = useState(64);
  const rates = useData<Rate[]>(["rates", r.region], EP.rates + query({ region: r.region }));
  const role = useAuth((state) => state.role);
  const { run, busy } = useAction();
  const rateFor = (code: string) => rates.data?.find((item) => item.kind === "vgpu" && item.pool === code && item.unit === "per_gpu_hour")?.unitPrice;
  const changeNodeState = (nodeUuid: string, action: "cordon" | "uncordon") => run(() => post(`${EP.resources}/${r.resourceUuid}/${action}`, { nodeUuid }));
  const changePoolSize = async () => {
    if (resizePool == null) return;
    const result = await run(() => post(`${EP.resources}/${r.resourceUuid}/resize`, { poolIndex: resizePool, count: targetNodes, minNodes, maxNodes }));
    if (result) setResizePool(null);
  };
  const currentPool = resizePool == null ? undefined : r.spec.nodePools[resizePool];
  const currentCount = currentPool?.nodeCount || 0;
  const gpuDelta = currentPool ? (targetNodes - currentCount) * currentPool.gpuPerNode : 0;
  const hourlyDelta = currentPool && rates.data ? gpuDelta * (rateFor(currentPool.poolCode) || 0) : null;
  return (
    <div className="stack">
      {r.spec.nodePools.map((p, i) => (
        <Panel key={i} title={`${p.name || `gpu-pool-${i + 1}`} · ${poolDisplayName(p.poolCode)}`} action={<Button disabled={!canWrite(role) || busy} onClick={() => { setResizePool(i); setTargetNodes(p.nodeCount); setMinNodes(p.minNodes ?? 1); setMaxNodes(p.maxNodes ?? 64); }}>{t("cluster.adjustNodeCount")}</Button>}>
          <KeyValues
            items={[
              [t("resource.nodeCount"), `${p.nodeCount} · ready ${q.data?.nodes.filter((n) => n.poolIndex === i && n.state === "ready").length ?? "—"}`],
              [`${t("eks.minNodes")} / ${t("eks.maxNodes")}`, `${p.minNodes ?? 1} / ${p.maxNodes ?? 64}`],
              [t("resource.gpu"), `${p.nodeCount * p.gpuPerNode} · allocated ${q.data?.nodes.filter((n) => n.poolIndex === i).reduce((a, n) => a + n.allocatedGpu, 0) ?? 0}`],
              ["CPU / RAM", `${q.data?.nodes.filter((n) => n.poolIndex === i).reduce((a, n) => a + n.cpuCount, 0) ?? 0} vCPU / ${q.data?.nodes.filter((n) => n.poolIndex === i).reduce((a, n) => a + n.memoryGb, 0) ?? 0} GB`],
              [t("resource.slicing"), p.slicingPolicy + " · " + p.migProfile],
              [t("cluster.autoscaler"), t("common." + (q.data?.poolStatus || "pending"))],
            ]}
          />
          <div style={{ marginTop: 12 }}><Progress value={q.data ? (100 * q.data.nodes.filter((n) => n.poolIndex === i).reduce((a, n) => a + n.allocatedGpu, 0)) / (p.nodeCount * p.gpuPerNode) : 0} /></div>
        </Panel>
      ))}
      <Panel title={t("cluster.nodes")}>
        <DataTable
          data={q.data?.nodes || []}
          onRow={setSelected}
          columns={[
            { accessorKey: "name", header: t("common.name") },
            { accessorKey: "poolName", header: t("cluster.nodePool") },
            { accessorKey: "state", header: t("common.status"), cell: ({ row }) => <Badge status={row.original.state} /> },
            { accessorKey: "gpuModel", header: t("eks.gpuModel") },
            { accessorKey: "gpuCount", header: "GPU" },
            { accessorKey: "allocatedGpu", header: t("cluster.gpuAllocated") },
            { id: "straggler", header: "Straggler", cell: ({ row }) => row.original.straggler ? <span className="danger-text">⚠ {number(row.original.ratio, 2)}×</span> : number(row.original.ratio, 2) + "×" },
            { id: "scheduler", header: t("cluster.scheduling"), cell: ({ row }) => <Button variant="ghost" disabled={!canWrite(role) || busy || r.status !== "running"} onClick={(event) => { event.stopPropagation(); void changeNodeState(row.original.nodeUuid, row.original.cordoned ? "uncordon" : "cordon"); }}>{t(row.original.cordoned ? "cluster.resumeScheduling" : "cluster.stopScheduling")}</Button> },
          ]}
        />
      </Panel>
      {q.data && (
        <Panel title={t("cluster.plugins")}>
          <KeyValues
            items={[
              [t("eks.gpuTargets"), r.spec.nodePools.filter((pool) => pool.role !== "general").map((pool) => pool.name).join(" / ") || t("eks.noGpuPool")],
              ["GPU Operator", q.data.plugins.driverDesired ? `${q.data.plugins.gpuOperator} · ${t(q.data.plugins.gpuOperatorReady ? "eks.pluginReady" : "eks.pluginPending")}` : t("eks.noGpuPool")],
              [
                "Device Plugin",
                !q.data.plugins.driverDesired ? t("eks.noGpuPool") : q.data.plugins.devicePluginHealthy
                  ? t("eks.pluginReady")
                  : t("eks.pluginPending"),
              ],
              ["NFD", q.data.plugins.driverDesired ? `${q.data.plugins.nfdVersion} · ${t(q.data.plugins.nfdReady ? "eks.pluginReady" : "eks.pluginPending")}` : t("eks.noGpuPool")],
              [t("eks.deploymentPolicy"), t("eks.platformManagedWithNodes")],
              [
                "Driver DaemonSet",
                `${q.data.plugins.driverReady}/${q.data.plugins.driverDesired}`,
              ],
            ]}
          />
        </Panel>
      )}
      <Modal open={resizePool !== null} onClose={() => setResizePool(null)} title={t("cluster.adjustNodeCount")}>
        {currentPool && <div className="stack">
          <KeyValues items={[
            [t("cluster.nodePool"), poolDisplayName(currentPool.poolCode)],
            [t("common.current"), currentCount],
            [t("common.target"), targetNodes],
            [t("cluster.gpuDelta"), `${gpuDelta > 0 ? "+" : ""}${gpuDelta}`],
            [t("cluster.hourlyCostChange"), hourlyDelta == null ? "—" : `${hourlyDelta > 0 ? "+" : hourlyDelta < 0 ? "−" : ""}${money(Math.abs(hourlyDelta))} / h`],
          ]} />
          <Field label={t("cluster.targetNodeCount")} hint="1–64">
            <input className="input" type="number" min={1} max={64} value={targetNodes} onChange={(event) => setTargetNodes(Number(event.target.value))} />
          </Field>
          <div className="form-grid">
            <Field label={t("eks.minNodes")}><input className="input" type="number" min={1} max={64} value={minNodes} onChange={(event) => setMinNodes(Number(event.target.value))} /></Field>
            <Field label={t("eks.maxNodes")}><input className="input" type="number" min={1} max={64} value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} /></Field>
          </div>
          <Button variant="primary" disabled={!canWrite(role) || busy || !Number.isInteger(targetNodes) || !Number.isInteger(minNodes) || !Number.isInteger(maxNodes) || minNodes < 1 || maxNodes > 64 || minNodes > targetNodes || targetNodes > maxNodes} onClick={() => void changePoolSize()}>{t("common.confirm")}</Button>
        </div>}
      </Modal>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || t("cluster.nodes")}
      >
        {selected && (
          <KeyValues items={[
            [t("cluster.nodePool"), selected.poolName],
            [t("common.status"), selected.state],
            ["Node IP", selected.privateIp],
            [t("eks.availableZones"), selected.zone],
            ["OS / Kubernetes", `${selected.os} / ${selected.k8sVersion}`],
            [t("eks.gpuModel"), selected.gpuModel],
            ["GPU", `${selected.allocatedGpu} / ${selected.gpuCount}`],
            ["vCPU", `${selected.allocatedCpu} / ${selected.cpuCount}`],
            ["RAM", `${selected.allocatedMemoryGb} / ${selected.memoryGb} GB`],
            [t("eks.localPv"), `${selected.allocatedLocalGb} / ${r.spec.localPvGb || 0} GB`],
            [t("eks.nodeSelector"), Object.entries(selected.labels).map(([key, value]) => `${key}=${value}`).join(", ")],
            [t("eks.gpuTaint"), selected.taints.join(", ") || "—"],
            [t("cluster.scheduling"), selected.cordoned ? t("cluster.stopScheduling") : t("common.enabled")],
          ]} />
        )}
      </Modal>
    </div>
  );
}
function clusterReason(reason: string) {
  if (reason === "Cluster is not running") return t("eks.clusterNotRunning");
  if (reason === "No node matches the pool selector, taint tolerance and scheduling state") return t("eks.noMatchingNode");
  if (reason === "Insufficient GPU, CPU or memory on matching nodes") return t("eks.insufficientNodeCapacity");
  if (reason === "PVC is not bound to an available storage volume") return t("eks.pvcNotBound");
  if (reason === "Insufficient local PV capacity on matching nodes") return t("eks.localPvInsufficient");
  return reason;
}
export function WorkloadsPanel({ resource: r }: { resource: ResourceOf<"vgpu"> }) {
  const q = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: true },
  );
  const role = useAuth((state) => state.role);
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("default");
  const [kind, setKind] = useState<"Deployment" | "StatefulSet" | "Job">("Deployment");
  const [replicas, setReplicas] = useState(1);
  const [gpuPerPod, setGpuPerPod] = useState(1);
  const [cpuPerPod, setCpuPerPod] = useState(4);
  const [memoryGbPerPod, setMemoryGbPerPod] = useState(16);
  const [nodePoolName, setNodePoolName] = useState("");
  const [gpuModel, setGpuModel] = useState("");
  const [selectorKey, setSelectorKey] = useState("");
  const [selectorValue, setSelectorValue] = useState("");
  const [pvcName, setPvcName] = useState("");
  const [localStorageGb, setLocalStorageGb] = useState(0);
  const [tolerateGpuTaint, setTolerateGpuTaint] = useState(true);
  const submit = async () => {
    const result = await run(() => post(`${EP.resources}/${r.resourceUuid}/workloads`, {
      name: name.trim(), namespace: namespace.trim(), kind, replicas,
      gpuPerPod, cpuPerPod, memoryGbPerPod, nodePoolName, gpuModel,
      selectorKey: selectorKey.trim(), selectorValue: selectorValue.trim(),
      pvcName, localStorageGb, tolerateGpuTaint,
    }));
    if (result) { setOpen(false); setName(""); }
  };
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data;
  return (
    <div className="stack">
      <Panel title={t("tab.workloads")} action={<Button variant="primary" disabled={!canWrite(role) || busy || r.status !== "running"} onClick={() => setOpen(true)}> {t("eks.createWorkload")}</Button>}>
        <KeyValues items={[
          [t("eks.gpuCapacity"), `${data.summary.gpuAllocated} ${t("eks.allocated")} / ${data.summary.gpuTotal} ${t("eks.physical")}`],
          [t("eks.cpuRequests"), `${data.summary.cpuAllocated} / ${data.summary.cpuTotal} vCPU`],
          [t("eks.memoryRequests"), `${data.summary.memoryGbAllocated} / ${data.summary.memoryGbTotal} GB`],
          ["Scheduling", data.scheduling.length ? `${data.scheduling.reduce((n, item) => n + item.count, 0)} Pending` : "Ready"],
        ]} />
      </Panel>
      {data.workloads.length === 0 && <Empty text={t("common.noData")} />}
      {data.workloads.map((workload) => (
        <Panel key={workload.id} title={`${workload.kind} · ${workload.namespace}/${workload.deployment}`}
          action={<Button variant="ghost" disabled={!canWrite(role) || busy} onClick={() => {
            if (window.confirm(`Delete ${workload.namespace}/${workload.deployment}?`))
              void run(() => post(`${EP.resources}/${r.resourceUuid}/workloads/${workload.id}/delete`, {}));
          }}>{t("common.delete")}</Button>}>
          <KeyValues items={[
            [t("eks.readyDesired"), `${workload.pods.filter((p) => p.phase === "Running").length} / ${workload.pods.length}`],
            [t("eks.perPod"), `${workload.gpuPerPod} GPU · ${workload.cpuPerPod} vCPU · ${workload.memoryGbPerPod} GB`],
            [t("cluster.nodePool"), workload.nodePoolName || t("eks.anyPool")],
            [t("eks.gpuModel"), workload.gpuModel || t("eks.anyPool")],
            [t("eks.nodeSelector"), workload.selectorKey ? `${workload.selectorKey}=${workload.selectorValue}` : "—"],
            ["PVC", workload.pvcName || "—"],
            [t("eks.localPv"), workload.localStorageGb ? `${workload.localStorageGb} GB / Pod` : "—"],
            ["GPU taint", workload.tolerateGpuTaint ? t("eks.tolerated") : t("eks.notTolerated")],
          ]} />
          <DataTable data={workload.pods} columns={[
            { accessorKey: "name", header: "Pod" },
            { accessorKey: "phase", header: t("common.status"), cell: ({ row }) => <Badge status={row.original.phase.toLowerCase()} /> },
            { accessorKey: "gpuCount", header: t("eks.gpuRequest") },
            { accessorKey: "cpuCount", header: t("eks.cpuRequest") },
            { accessorKey: "memoryGb", header: t("eks.ramGb") },
            { accessorKey: "pvcName", header: "PVC", cell: ({ row }) => row.original.pvcName || "—" },
            { id: "node", header: t("cluster.nodes"), cell: ({ row }) => row.original.nodeUuid || "—" },
            { accessorKey: "waitingReason", header: t("cluster.waitingReason"), cell: ({ row }) => clusterReason(row.original.waitingReason) || "—" },
          ]} />
        </Panel>
      ))}
      {data.scheduling.length > 0 && <Panel title={t("cluster.scheduling")}>
        <DataTable data={data.scheduling} columns={[
          { accessorKey: "reason", header: t("common.reason"), cell: ({ row }) => clusterReason(row.original.reason) },
          { accessorKey: "count", header: t("common.count") },
        ]} />
      </Panel>}
      <Modal open={open} onClose={() => setOpen(false)} title={t("eks.createWorkloadTitle")}>
        <div className="stack">
          <div className="form-grid">
            <Field label={t("eks.kind")}><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option>Deployment</option><option>StatefulSet</option><option>Job</option></select></Field>
            <Field label={t("eks.namespace")}><input className="input" value={namespace} onChange={(e) => { setNamespace(e.target.value); setPvcName(""); }} /></Field>
            <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("eks.replicas")}><input className="input" type="number" min={1} max={64} value={replicas} onChange={(e) => setReplicas(Number(e.target.value))} /></Field>
            <Field label={t("eks.gpuPerPod")}><input className="input" type="number" min={0} max={72} value={gpuPerPod} onChange={(e) => setGpuPerPod(Number(e.target.value))} /></Field>
            <Field label={t("eks.cpuPerPod")}><input className="input" type="number" min={1} max={128} value={cpuPerPod} onChange={(e) => setCpuPerPod(Number(e.target.value))} /></Field>
            <Field label={t("eks.memoryPerPod")}><input className="input" type="number" min={1} max={1024} value={memoryGbPerPod} onChange={(e) => setMemoryGbPerPod(Number(e.target.value))} /></Field>
            <Field label={t("cluster.nodePool")}><select value={nodePoolName} onChange={(e) => setNodePoolName(e.target.value)}><option value="">{t("eks.anyPool")}</option>{r.spec.nodePools.map((pool, i) => <option key={i} value={pool.name || `gpu-pool-${i+1}`}>{pool.name || `gpu-pool-${i+1}`} · {poolDisplayName(pool.poolCode)}</option>)}</select></Field>
            <Field label={t("eks.gpuModel")}><select value={gpuModel} onChange={(e) => setGpuModel(e.target.value)}><option value="">{t("eks.anyPool")}</option>{[...new Set((q.data?.nodes || []).map((node) => node.gpuModel))].map((model) => <option key={model} value={model}>{model}</option>)}</select></Field>
            <Field label={t("eks.nodeSelector")}><input className="input" placeholder="workload.runsuncloud.com/type" value={selectorKey} onChange={(e) => setSelectorKey(e.target.value)} /></Field>
            <Field label={t("eks.selectorValue")}><input className="input" value={selectorValue} onChange={(e) => setSelectorValue(e.target.value)} /></Field>
            <Field label="PVC"><select value={pvcName} onChange={(e) => setPvcName(e.target.value)}><option value="">{t("eks.noPvc")}</option>{data.storage.pvcs.filter((claim) => claim.namespace === namespace && claim.status === "Bound").map((claim) => <option key={claim.name} value={claim.name}>{claim.name} · {claim.sizeGb} GB</option>)}</select></Field>
            {(r.spec.localPvGb || 0) > 0 && <Field label={t("eks.localStoragePerPod")}><input className="input" type="number" min={0} max={r.spec.localPvGb} value={localStorageGb} onChange={(e) => setLocalStorageGb(Number(e.target.value))} /></Field>}
            <Field label={t("eks.gpuTaint")}><select value={tolerateGpuTaint ? "yes" : "no"} onChange={(e) => setTolerateGpuTaint(e.target.value === "yes")}><option value="yes"> {t("eks.tolerate")}</option><option value="no"> {t("eks.doNotTolerate")}</option></select></Field>
          </div>
          <small> {t("eks.schedulerHint")}</small>
          <Button variant="primary" disabled={busy || !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(name.trim()) || !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(namespace.trim()) || !Number.isInteger(replicas) || replicas < 1 || replicas > 64 || !Number.isInteger(gpuPerPod) || gpuPerPod < 0 || gpuPerPod > 72 || !Number.isInteger(cpuPerPod) || cpuPerPod < 1 || cpuPerPod > 128 || !Number.isInteger(memoryGbPerPod) || memoryGbPerPod < 1 || memoryGbPerPod > 1024 || (!!selectorKey.trim() !== !!selectorValue.trim()) || !Number.isInteger(localStorageGb) || localStorageGb < 0 || localStorageGb > (r.spec.localPvGb || 0)} onClick={() => void submit()}>{t("common.create")}</Button>
        </div>
      </Modal>
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
            [t("eks.csiState"), t("eks.managedCsi")],
            [t("eks.defaultStorageClass"), r.spec.storageClass],
            [t("eks.storageScheme"), t(`eks.storageMode.${r.spec.storageMode || "dynamic_block"}`)],
            [t("eks.availableLocalCapacity"), `${q.data.nodes.filter((node) => node.state === "ready").reduce((total, node) => total + Math.max(0, (r.spec.localPvGb || 0) - node.allocatedLocalGb), 0)} GB`],
            ["CNI errors", q.data.network.cniErrors],
            ["Service P99", q.data.network.serviceP99Ms == null ? "—" : q.data.network.serviceP99Ms + " ms"],
            [t("eks.clusterEntryTitle"), t(r.spec.ingressEnabled ? "eks.entryIngress" : "eks.entryInternal")],
            [t("eks.ingressController"), r.spec.ingressEnabled ? `${r.spec.ingressClass.toUpperCase()} · ${t(q.data.plugins.ingressControllerReady ? "eks.pluginReady" : "eks.pluginPending")}` : t("eks.controllerDisabled")],
            [t("eks.ingressResource"), r.spec.ingressEnabled ? t("eks.noIngressRoutes") : "—"],
            ["Ingress QPS", r.spec.ingressEnabled ? q.data.network.ingressQps : t("common.notEnabled")],
            ["VPC peering", t("common." + q.data.network.vpcPeering)],
            [
              "PVC Bound / Pending",
              q.data.storage.provisioned ? `${q.data.storage.bound} / ${q.data.storage.pending}` : t("cluster.pvcNotProvisioned"),
            ],
            [t("cluster.pendingReason"), q.data.storage.provisioned ? (q.data.storage.pendingReason || "—") : "—"],
            ["PV", q.data.storage.provisioned ? q.data.storage.pvCapacityGb + " GB" : "—"],
            ["CSI errors", q.data.storage.csiErrors],
          ]}
        />
      </Panel>
      {q.data.storage.pvs.length > 0 && <Panel title="PersistentVolumes">
        <DataTable data={q.data.storage.pvs} columns={[
          { accessorKey: "name", header: "PV" },
          { accessorKey: "source", header: t("common.type") },
          { id: "accessMode", header: t("eks.accessMode"), cell: ({ row }) => t(row.original.source === "file" ? "eks.rwx" : "eks.rwo") },
          { accessorKey: "sizeGb", header: t("storage.sizeGb") },
          { accessorKey: "zone", header: t("eks.availableZones") },
          { accessorKey: "nodeUuid", header: t("cluster.nodes"), cell: ({ row }) => row.original.nodeUuid || "—" },
          { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge status={row.original.status.toLowerCase()} /> },
        ]} />
      </Panel>}
      {q.data.storage.pvcs.length > 0 && <Panel title="PersistentVolumeClaims">
        <DataTable data={q.data.storage.pvcs} columns={[
          { accessorKey: "namespace", header: t("eks.namespace") },
          { accessorKey: "name", header: "PVC" },
          { accessorKey: "pvName", header: "PV", cell: ({ row }) => row.original.pvName || "—" },
          { accessorKey: "sizeGb", header: t("storage.sizeGb") },
          { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge status={row.original.status.toLowerCase()} /> },
        ]} />
      </Panel>}
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
            { accessorKey: "gpuModel", header: "GPU model" },
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
