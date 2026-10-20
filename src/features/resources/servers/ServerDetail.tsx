import { ResourceNetwork } from "../../network/ResourceNetwork";
import { useState } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import { Panel, Tabs, KeyValues } from "../../../components/ui";
import { date } from "../../../lib/date";
import {
  MetricsOverview,
  MonitorPanel,
  AccessPanel,
  SpecPanel,
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
  Associations,
} from "../shared/common";
export function ServerDetail({
  resource: r,
}: {
  resource: ResourceOf<"gpu_vm">;
}) {
  const [tab, setTab] = useState("overview");
  const tabs = [
    "overview",
    "monitoring",
    "console",
    "configuration",
    "network",
    "events",
    "billing",
    "scaling",
    "associations",
  ];
  return (
    <>
      <Tabs
        items={tabs.map((id) => ({
          id,
          label: t(id === "scaling" ? "resource.scaling" : `tab.${id}`),
        }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "overview" ? (
        <div className="stack">
          <Panel title={t("tab.overview")}>
            <KeyValues
              items={[
                [t("resource.gpu"), `${r.spec.gpuModel} × ${r.spec.gpuCount}`],
                [
                  t("resource.cpu"),
                  `${r.spec.vcpu} vCPU / ${r.spec.memoryGb} GB`,
                ],
                [t("wizard.imageStorage"), r.spec.imageRef],
                [t("common.region"), t("common." + r.region)],
                [t("resource.pool"), r.nodePool],
                [t("common.createdAt"), date(r.createdAt)],
              ]}
            />
          </Panel>
          <MetricsOverview resource={r} />
        </div>
      ) : tab === "monitoring" ? (
        <MonitorPanel resource={r} />
      ) : tab === "console" ? (
        <AccessPanel resource={r} />
      ) : tab === "network" ? (
        <ResourceNetwork resource={r} />
      ) : tab === "configuration" ? (
        <SpecPanel resource={r} />
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
