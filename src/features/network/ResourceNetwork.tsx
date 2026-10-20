import type { Resource } from "../../types/domain";
import { EP } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { t } from "../../i18n";
import { Panel, Loading, ErrorState } from "../../components/ui";
import { InterfaceTable } from "./NetworkPages";
import type { InterfaceView } from "./model";
export function ResourceNetwork({ resource: r }: { resource: Resource }) {
  const q = useData<{ interfaces: InterfaceView[] }>(
    ["resource-network", r.resourceUuid],
    EP.resourceNetwork(r.resourceUuid),
    { poll: true },
  );
  return (
    <Panel title={t("nav.network")}>
      <p className="muted">{t("network.resourceHint")}</p>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <InterfaceTable data={q.data?.interfaces || []} />
      )}
    </Panel>
  );
}
