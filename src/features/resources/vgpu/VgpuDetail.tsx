import { useState, lazy, Suspense } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import {
  Panel,
  Tabs,
  KeyValues,
  Progress,
  Loading,
  DataTable,
} from "../../../components/ui";
import {
  MonitorPanel,
  SpecPanel,
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
  Associations,
  Kubeconfig,
} from "../shared/common";
const TopologyView = lazy(() => import("../../../components/ops/TopologyView"));
export function VgpuDetail({ resource: r }: { resource: ResourceOf<"vgpu"> }) {
  const [tab, setTab] = useState("overview");
  const topology = import.meta.env.VITE_FEATURE_TOPOLOGY !== "false";
  return (
    <>
      <Tabs
        items={[
          "overview",
          "controlPlane",
          "nodePools",
          "workloads",
          "network",
          ...(topology ? ["topology"] : []),
          "events",
          "billing",
          "scaling",
          "associations",
        ].map((id) => ({
          id,
          label: t(id === "scaling" ? "resource.scaling" : `tab.${id}`),
        }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "overview" ? (
        <Panel title={t("tab.overview")} action={<Kubeconfig resource={r} />}>
          <KeyValues
            items={[
              [t("resource.k8s"), r.spec.k8sVersion],
              [t("wizard.controlPlane"), r.spec.controlPlaneTier],
              [
                t("resource.nodeCount"),
                r.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0),
              ],
              [t("resource.gpu"), r.spec.gpuCount],
              [t("wizard.networkStorage"), r.spec.storageClass],
            ]}
          />
        </Panel>
      ) : tab === "controlPlane" ? (
        <MonitorPanel
          resource={r}
          only={["apiserver_latency_p99", "etcd_fsync_p99"]}
        />
      ) : tab === "nodePools" ? (
        <div className="stack">
          {r.spec.nodePools.map((p, i) => (
            <Panel key={i} title={p.poolCode}>
              <KeyValues
                items={[
                  [t("resource.nodeCount"), p.nodeCount],
                  [t("resource.gpu"), p.nodeCount * p.gpuPerNode],
                  [t("resource.slicing"), p.slicingPolicy + " " + p.migProfile],
                ]}
              />
              <div style={{ marginTop: 20 }}>
                <Progress value={r.status === "running" ? 75 : 0} />
              </div>
            </Panel>
          ))}
        </div>
      ) : tab === "workloads" ? (
        <Panel title={t("tab.workloads")}>
          <DataTable
            data={r.spec.nodePools.map((p, i) => ({
              namespace: "default",
              deployment: r.displayId + "-" + i,
              pods: p.nodeCount,
              status: r.status === "running" ? "Running" : "Pending",
              reason:
                r.status === "running" ? "—" : "Insufficient nvidia.com/gpu",
            }))}
            columns={[
              { accessorKey: "namespace", header: "Namespace" },
              { accessorKey: "deployment", header: "Deployment" },
              { accessorKey: "pods", header: "Pods" },
              { accessorKey: "status", header: t("common.status") },
              { accessorKey: "reason", header: t("common.reason") },
            ]}
          />
        </Panel>
      ) : tab === "network" ? (
        <SpecPanel resource={r} />
      ) : tab === "topology" ? (
        <Panel title={t("tab.topology")}>
          <Suspense fallback={<Loading />}>
            <TopologyView resource={r} />
          </Suspense>
        </Panel>
      ) : tab === "events" ? (
        <EventsPanel resource={r} />
      ) : tab === "billing" ? (
        <BillingPanel resource={r} />
      ) : tab === "scaling" ? (
        <ScalingReadonly resource={r} />
      ) : (
        <Associations resource={r} />
      )}
    </>
  );
}
