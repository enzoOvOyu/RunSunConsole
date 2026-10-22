import { gpuModelDisplayName } from "../../../lib/gpu-labels";
import { ResourceNetwork } from "../../network/ResourceNetwork";
import { MachineInventory, MachineFirmware } from "./MachinePanels";
import type { BaremetalMachine } from "../../../types/baremetal";
import { EP } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { HardwareHealthPanel } from "../shared/RuntimePanels";
import { useState } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import {
  Panel,
  Tabs,
  KeyValues,
  Field,
  Loading,
  ErrorState,
} from "../../../components/ui";
import { size } from "../../../lib/money";
import {
  MetricsOverview,
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
} from "../shared/common";
export function BaremetalDetail({
  resource: r,
}: {
  resource: ResourceOf<"gpu_baremetal">;
}) {
  const [tab, setTab] = useState("overview");
  const [node, setNode] = useState(0);
  const selected = Math.min(node, r.spec.machineCount - 1);
  const machines = useData<BaremetalMachine[]>(
    ["baremetal-machines", r.resourceUuid],
    EP.machines(r.resourceUuid),
    { poll: true },
  );
  const machine = machines.data?.[selected];

  return (
    <>
      <Tabs
        items={[
          "overview",
          "hardware",
          "network",
          "firmware",
          "events",
          "billing",
          "scaling",
        ].map((id) => ({
          id,
          label: t(id === "scaling" ? "resource.scaling" : `tab.${id}`),
        }))}
        value={tab}
        onChange={setTab}
      />
      {["hardware", "network", "firmware"].includes(tab) && (
        <Field label={t("baremetal.selectedMachine")}>
          <select
            aria-label={t("baremetal.selectedMachine")}
            value={selected}
            onChange={(e) => setNode(Number(e.target.value))}
          >
            {(machines.data || []).map((m) => (
              <option key={m.nodeUuid} value={m.index}>
                {m.name} · {m.privateIp}
              </option>
            ))}
          </select>
        </Field>
      )}
      {["hardware", "network"].includes(tab) && machine && (
        <Panel title={machine.name}>
          <KeyValues
            items={[
              [t("baremetal.hostname"), machine.hostname],
              [t("baremetal.privateIp"), machine.privateIp],
              [t("baremetal.bmcIp"), machine.bmcIp],
              [t("baremetal.memory"), size(machine.memoryGb)],
              [t("resource.nvme"), size(machine.localNvmeGb)],
              [t("resource.rack"), machine.rack],
            ]}
          />
        </Panel>
      )}
      {tab === "overview" ? (
        <div className="stack">
          <Panel title={t("tab.overview")}>
            <KeyValues
              items={[
                [t("resource.gpuModel"), gpuModelDisplayName(r.spec.gpuModel)],

                [
                  t("resource.machineCount"),
                  `${r.spec.machineCount} ${t("common.machines")}`,
                ],
                [t("resource.gpuQuantity"), r.spec.gpuCount],
                [t("baremetal.cpuPerMachine"), r.spec.cpuModel],
                [
                  t("baremetal.clusterMemory"),
                  size(r.spec.memoryGb * r.spec.machineCount),
                ],
                [
                  t("baremetal.clusterNvme"),
                  size(r.spec.localNvmeGb * r.spec.machineCount),
                ],
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
          {machines.isPending ? (
            <Loading />
          ) : machines.error ? (
            <ErrorState error={machines.error} />
          ) : (
            <MachineInventory
              machines={machines.data}
              onSelect={(m) => {
                setNode(m.index);
                setTab("hardware");
              }}
            />
          )}
          <MetricsOverview resource={r} />
        </div>
      ) : tab === "hardware" ? (
        <HardwareHealthPanel resource={r} nodeIndex={selected} />
      ) : tab === "firmware" ? (
        machine ? (
          <MachineFirmware resource={r} machine={machine} />
        ) : (
          <Loading />
        )
      ) : tab === "network" ? (
        <div className="stack">
          <ResourceNetwork resource={r} />
          <HardwareHealthPanel resource={r} nodeIndex={selected} networkOnly />
        </div>
      ) : tab === "events" ? (
        <EventsPanel resource={r} />
      ) : tab === "billing" ? (
        <BillingPanel resource={r} />
      ) : tab === "scaling" ? (
        <ScalingReadonly resource={r} />
      ) : null}
    </>
  );
}
