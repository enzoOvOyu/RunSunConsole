import { useState } from "react";
import type { ResourceOf, SliceCatalogItem } from "../../../types/domain";
import { EP, query } from "../../../lib/api-client";
import { money } from "../../../lib/money";
import { t } from "../../../i18n";
import { KeyValues, Panel, Tabs } from "../../../components/ui";
import { useData } from "../../shared/hooks";
import { BillingPanel, EventsPanel } from "../shared/common";

export function SliceDetail({ resource: r }: { resource: ResourceOf<"vgpu"> }) {
  const [tab, setTab] = useState("overview");
  const catalog = useData<SliceCatalogItem[]>(["slice-catalog", r.region, r.projectId],
    EP.slices + query({ region: r.region, project_id: r.projectId }));
  const sku = catalog.data?.find((item) => item.id === r.spec.slice?.skuId);
  const allocation = r.spec.slice;
  const allocationState = r.deletedAt || r.status === "stopped" ? "released" :
    r.status === "terminating" ? "releasing" : r.status === "provisioning" ? "allocating" :
    r.status === "error" ? "failed" : "running";
  return <>
    <Tabs items={["overview", "workspace", "network", "events", "billing"].map((id) => ({
      id, label: t(id === "workspace" ? "slice.workspace" : `tab.${id}`),
    }))} value={tab} onChange={setTab} />
    {tab === "overview" ? <div className="stack">
      <Panel title={t("slice.sharedWorkspaceTitle")}><KeyValues items={[
        [t("slice.modeTitle"), t("slice.slice")], [t("slice.skuTitle"), allocation?.skuId || "—"],
        [t("slice.profile"), allocation?.profile || sku?.profile || "—"], [t("slice.gpuModel"), allocation?.gpuModel || sku?.gpuModel || "—"],
        [t("slice.memory"), allocation?.memoryGb || sku?.memoryGb ? `${allocation?.memoryGb || sku?.memoryGb} GB` : "—"], [t("slice.quantity"), allocation?.count || 0],
        [t("slice.unitPrice"), allocation?.unitPriceUsd !== undefined ? money(allocation.unitPriceUsd) : "—"],
        [t("slice.hourly"), money(r.cost?.perHour || 0)], [t("resource.k8s"), r.spec.k8sVersion],
        [t("common.region"), t(`common.${r.region}`)], [t("common.status"), t(`slice.state.${allocationState}`)],
      ]} /><small>{t("slice.mockBoundary")}</small></Panel>
      <Panel title={t("slice.inventoryAssignment")}><KeyValues items={[
        [t("slice.layout"), allocation?.layoutId || sku?.layoutId || "—"],
        [t("slice.gpuResource"), allocation?.kubernetesResource || sku?.kubernetesResource || "—"],
        [t("slice.assignedInstances"), allocation?.instanceIds?.length || 0],
        [t("slice.instanceIds"), allocation?.instanceIds?.join(", ") || "—"],
        [t("slice.workspace"), allocation?.workspaceId || "—"],
      ]} /></Panel>
    </div> : tab === "workspace" ? <Panel title={t("slice.workspace")}><KeyValues items={[
      [t("slice.workspace"), allocation?.workspaceId || "—"],
      ["Namespace", allocation?.namespace || "—"],
      [t("slice.projectQuota"), `${allocation?.count || 0} ${t("slice.quantity")}`],
      ["RBAC", t("slice.namespaceRbac")],
      [t("slice.gpuResource"), allocation?.kubernetesResource || sku?.kubernetesResource || "—"],
      [t("slice.pvcCapacity"), `${r.spec.defaultPvcGb} GB`],
      [t("eks.storageScheme"), t(`eks.storageMode.${r.spec.storageMode || "dynamic_block"}`)],
    ]} /><small>{t("slice.accessMock")}</small></Panel>
      : tab === "network" ? <Panel title={t("eks.vpcConfig")}><KeyValues items={[
        ["VPC", r.spec.vpc], [t("eks.subnetConfig"), r.spec.subnet],
        [t("slice.accessScope"), t("slice.internalOnly")],
      ]} /><small>{t("slice.networkIsolationMock")}</small></Panel>
      : tab === "events" ? <EventsPanel resource={r} />
      : tab === "billing" ? <BillingPanel resource={r} /> : null}
  </>;
}
