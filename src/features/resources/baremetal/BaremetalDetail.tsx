import { useState } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import { Panel, Tabs, KeyValues } from "../../../components/ui";
import { size } from "../../../lib/money";
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
export function BaremetalDetail({
  resource: r,
}: {
  resource: ResourceOf<"gpu_baremetal">;
}) {
  const [tab, setTab] = useState("overview");
  return (
    <>
      <Tabs
        items={[
          "overview",
          "hardware",
          "oob",
          "network",
          "firmware",
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
        <div className="stack">
          <Panel title={t("tab.overview")}>
            <KeyValues
              items={[
                [t("resource.machineType"), r.spec.machineType],
                [
                  t("resource.machineCount"),
                  `${r.spec.machineCount} ${t("common.machines")}`,
                ],
                [t("resource.totalGpu"), r.spec.gpuCount],
                [
                  t("resource.cpu"),
                  `${r.spec.cpuModel} / ${size(r.spec.memoryGb)}`,
                ],
                [t("resource.nvme"), size(r.spec.localNvmeGb)],
                [
                  t("wizard.passthrough"),
                  r.spec.passthrough
                    ? t("common.enabled")
                    : t("common.disabled"),
                ],
                ["RAID", r.spec.raidLevel],
              ]}
            />
          </Panel>
          <MetricsOverview resource={r} />
        </div>
      ) : tab === "hardware" ? (
        <MonitorPanel resource={r} />
      ) : tab === "oob" ? (
        <AccessPanel resource={r} mode="bmc" />
      ) : tab === "firmware" ? (
        <AccessPanel resource={r} mode="firmware" />
      ) : tab === "network" ? (
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
