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
        <ControlPlanePanel resource={r} />
      ) : tab === "nodePools" ? (
        <NodePoolsPanel resource={r} />
      ) : tab === "workloads" ? (
        <WorkloadsPanel resource={r} />
      ) : tab === "network" ? (
        <ClusterNetworkPanel resource={r} />
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
