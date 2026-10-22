import { gpuModelDisplayName, poolDisplayName } from "../../../lib/gpu-labels";
import { ResourceNetwork } from "../../network/ResourceNetwork";
import { useState } from "react";
import { RemoteTerminal } from "./RemoteTerminal";
import type { Image, ResourceOf } from "../../../types/domain";
import { EP } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { t } from "../../../i18n";
import { Panel, Tabs, KeyValues } from "../../../components/ui";
import { date } from "../../../lib/date";
import {
  MonitorPanel,
  SpecPanel,
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
  Associations,
} from "../shared/common";
export function ServerDetail({
  resource: r,
  canManage,
  onStart,
  onStop,
  onRestart,
}: {
  resource: ResourceOf<"gpu_vm">;
  canManage: boolean;
  onStart: () => Promise<unknown>;
  onStop: () => Promise<unknown>;
  onRestart: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState("overview");
  const images = useData<Image[]>(["images"], EP.images);
  const baseImage = images.data?.find((image) => image.id === r.spec.imageRef);
  const runtimeImage = images.data?.find(
    (image) => image.id === r.spec.runtimeImageRef,
  );
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
                [
                  t("resource.gpu"),
                  `${gpuModelDisplayName(r.spec.gpuModel)} × ${r.spec.gpuCount}`,
                ],
                [
                  t("resource.cpu"),
                  `${r.spec.vcpu} vCPU / ${r.spec.memoryGb} GB`,
                ],
                [
                  t("images.baseOperatingSystem"),
                  baseImage?.name || r.spec.imageRef,
                ],
                [t("images.gpuDriver"), baseImage?.driverVersion || "—"],
                [
                  t("images.frameworksIncluded"),
                  runtimeImage?.frameworks.join(", ") ||
                    t("images.noneIncluded"),
                ],
                ["CUDA", runtimeImage?.cudaVersion || t("images.noneIncluded")],
                [t("common.region"), t("common." + r.region)],
                [t("resource.pool"), poolDisplayName(r.nodePool)],
                [t("common.createdAt"), date(r.createdAt)],
              ]}
            />
          </Panel>
        </div>
      ) : tab === "monitoring" ? (
        <MonitorPanel resource={r} />
      ) : tab === "console" ? (
        <RemoteTerminal
          resource={r}
          authMethod={r.spec.authMethod || "ssh_key"}
          osName={baseImage?.name || r.spec.imageRef}
          osFamily={baseImage?.osFamily || r.spec.imageRef}
          driverVersion={baseImage?.driverVersion || undefined}
          cudaVersion={runtimeImage?.cudaVersion}
          canManage={canManage}
          onStart={onStart}
          onStop={onStop}
          onRestart={onRestart}
        />
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
