import { useData } from "../../shared/hooks";
import { EP } from "../../../lib/api-client";
import type { ClusterView } from "../../../types/monitoring";
import { ResourceNetwork } from "../../network/ResourceNetwork";
import {
  ControlPlanePanel,
  NodePoolsPanel,
  WorkloadsPanel,
  ClusterNetworkPanel,
} from "../shared/RuntimePanels";
import { useState, lazy, Suspense } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import { Panel, Tabs, KeyValues, Loading } from "../../../components/ui";
import {
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
  Associations,
  Kubeconfig,
} from "../shared/common";
const TopologyView = lazy(() => import("../../../components/ops/TopologyView"));
export function VgpuDetail({ resource: r }: { resource: ResourceOf<"vgpu"> }) {
  const [tab, setTab] = useState("overview");
  const cluster = useData<ClusterView>(
    ["cluster-runtime", r.resourceUuid],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/cluster`,
    { poll: tab === "overview" },
  );
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
              ["Cluster ID", r.displayId],
              [t("common.status"), r.status],
              [t("eks.description"), r.spec.description || "—"],
              ["Region", r.region.toUpperCase()],
              [t("eks.created"), new Date(r.createdAt).toLocaleString()],
              ["VPC / Subnet", `${r.spec.vpc} / ${r.spec.subnet}`],
              ["Pod / Service CIDR", `${r.spec.podCidr || "172.20.0.0/16"} / ${r.spec.serviceCidr || "172.21.0.0/16"}`],
              [t("wizard.controlPlane"), r.spec.controlPlaneTier],
              [
                t("resource.nodeCount"),
                r.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0),
              ],
              [t("resource.gpu"), cluster.data ? `${cluster.data.summary.gpuAllocated} ${t("eks.allocated")} / ${cluster.data.summary.gpuTotal} ${t("eks.physical")}` : r.spec.gpuCount],
              [t("eks.readyNodes"), cluster.data ? `${cluster.data.summary.readyNodes} / ${cluster.data.summary.totalNodes}` : "—"],
              ["CPU", cluster.data ? `${cluster.data.summary.cpuAllocated} allocated / ${cluster.data.summary.cpuTotal} vCPU` : "—"],
              ["Memory", cluster.data ? `${cluster.data.summary.memoryGbAllocated} allocated / ${cluster.data.summary.memoryGbTotal} GB` : "—"],
              [t("eks.health"), cluster.data?.scheduling.length ? `${cluster.data.scheduling.reduce((n, item) => n + item.count, 0)} Pending Pods` : r.status === "running" ? "Ready" : t("eks.initializing")],
              [t("wizard.networkStorage"), r.spec.storageClass],
            ]}
          />
        </Panel>
      ) : tab === "controlPlane" ? (
        <ControlPlanePanel resource={r} />
      ) : tab === "nodePools" ? (
        <NodePoolsPanel resource={r} />
      ) : tab === "workloads" ? (
        <WorkloadsPanel resource={r} />
      ) : tab === "network" ? (
        <div className="stack">
          <ResourceNetwork resource={r} />
          <ClusterNetworkPanel resource={r} />
        </div>
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
