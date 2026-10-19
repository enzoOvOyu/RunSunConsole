import { ReplicaManagement } from "../shared/RuntimePanels";
import { useState } from "react";
import type { ResourceOf } from "../../../types/domain";
import { t } from "../../../i18n";
import { EP } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { Panel, Tabs, Empty } from "../../../components/ui";
import {
  MonitorPanel,
  AccessPanel,
  SpecPanel,
  EventsPanel,
  BillingPanel,
  ScalingReadonly,
} from "../shared/common";
export function InferenceDetail({
  resource: r,
}: {
  resource: ResourceOf<"inference">;
}) {
  const [tab, setTab] = useState("instances");
  const [level, setLevel] = useState("");
  const logs = useData<
    {
      ts: string;
      level: string;
      requestId: string;
      route: string;
      status: number;
      latencyMs: number;
      promptTokens: number;
      genTokens: number;
      cacheHit: boolean;
      trace?: string;
    }[]
  >(["logs", r.resourceUuid], `${EP.resources}/${r.resourceUuid}/logs`, {
    enabled: tab === "logs",
    poll: tab === "logs",
  });
  return (
    <>
      <Tabs
        items={[
          "instances",
          "monitoring",
          "governance",
          "logs",
          "configuration",
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
      {tab === "instances" ? (
        <ReplicaManagement resource={r} />
      ) : tab === "monitoring" ? (
        <MonitorPanel resource={r} />
      ) : tab === "governance" ? (
        <AccessPanel resource={r} mode="governance" />
      ) : tab === "logs" ? (
        <Panel title={t("tab.logs")}>
          <select
            aria-label={t("common.filter")}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">{t("common.all")}</option>
            {["info", "warning", "error"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          {logs.data?.length ? (
            <div className="stack" style={{ marginTop: 16 }}>
              {logs.data
                .filter((l) => !level || l.level === level)
                .map((l) => (
                  <div
                    key={l.requestId}
                    className={l.level === "error" ? "error-box" : "notice"}
                  >
                    <pre>{JSON.stringify(l, null, 2)}</pre>
                    {l.trace && (
                      <details>
                        <summary>Traceback</summary>
                        <pre>{l.trace}</pre>
                      </details>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <Empty text={t("common.noData")} />
          )}
        </Panel>
      ) : tab === "configuration" ? (
        <SpecPanel resource={r} />
      ) : tab === "events" ? (
        <EventsPanel resource={r} />
      ) : tab === "billing" ? (
        <BillingPanel resource={r} />
      ) : (
        <ScalingReadonly resource={r} />
      )}
    </>
  );
}
