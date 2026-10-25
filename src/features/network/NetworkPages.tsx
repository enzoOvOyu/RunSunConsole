import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Network, Globe2, ShieldCheck, Cable } from "lucide-react";
import type { Project, Usage } from "../../types/domain";
import type { SubnetView, SecurityRule, Vpc } from "../../types/network";
import { EP, post, patch, remove, query } from "../../lib/api-client";
import { useAuth } from "../../stores/auth";
import { useRegion } from "../../stores/region";
import { canWrite } from "../../lib/rbac";
import { t, dt } from "../../i18n";
import { vpcNetworkType } from "../../lib/network";
import { money, number, unitMoney } from "../../lib/money";
import { date } from "../../lib/date";
import { formatResourceId, resourceLink } from "../../lib/ids";
import { useData, useAction } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { confirmAction } from "../../components/ui/ConfirmAction";
import {
  PageHeader,
  Button,
  Panel,
  DataTable,
  Modal,
  Field,
  KeyValues,
  Tabs,
  Badge,
  Loading,
  ErrorState,
  CopyButton,
} from "../../components/ui";
import { NetworkEditor, type EditorState } from "./NetworkEditor";
import {
  navKey,
  uiPath,
  type NetworkKind,
  type NetworkRecord,
  type NetworkDetail,
  type InterfaceView,
} from "./model";
import "./network.css";
const icons = {
  vpcs: Network,
  eips: Globe2,
  "security-groups": ShieldCheck,
  tunnels: Cable,
};
export const VpcsPage = () => <NetworkPage kind="vpcs" />;
export const EipsPage = () => <NetworkPage kind="eips" />;
export const SecurityGroupsPage = () => <NetworkPage kind="security-groups" />;
export const TunnelsPage = () => <NetworkPage kind="tunnels" />;
function NetworkPage({ kind }: { kind: NetworkKind }) {
  const [params, setParams] = useSearchParams();
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const writable = canWrite(role);
  const projectId = params.get("project_id") || "";
  const search = params.get("q") || "";
  const bindingFilter = params.get("binding") || "all";
  const releasedParam = params.get("includeReleased") === "true";
  const [includeReleased, setIncludeReleased] = useState(releasedParam);
  useEffect(() => setIncludeReleased(releasedParam), [releasedParam]);
  const id = params.get("drawer") || "";
  const projects = useData<Project[]>(["projects", region], EP.projects + query({ region }));
  const selectedProjectId = projects.data?.some((p) => p.id === projectId && !p.deletedAt)
    ? projectId
    : "";
  useEffect(() => {
    if (!projects.data || !projectId || selectedProjectId) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("project_id");
      return next;
    }, { replace: true });
  }, [projects.data, projectId, selectedProjectId, setParams]);
  const path = `${EP.network}/${kind}`;
  const q = useData<NetworkRecord[]>(
    [
      "network-list",
      kind,
      region,
      selectedProjectId,
      search,
      params.get("includeReleased"),
    ],
    path +
      query({
        region,
        project_id: selectedProjectId,
        q: search,
        includeReleased: params.get("includeReleased"),
      }),
    { enabled: !projectId || !!projects.data },
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const update = (key: string, value: string) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "drawer") next.delete("drawer");
        return next;
      },
      { replace: true },
    );
  const Icon = icons[kind];
  const items = [...(q.data || [])]
    .filter((item) => {
      if (kind !== "eips" || bindingFilter === "all") return true;
      if (!("interfaceId" in item)) return false;
      if (bindingFilter === "released") return !!item.releasedAt;
      if (item.releasedAt) return false;
      return bindingFilter === "bound"
        ? !!(item.interfaceId || item.tunnelId)
        : !item.interfaceId && !item.tunnelId;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <PageHeader
        title={
          <span className="row">
            <Icon size={25} />
            {t(`nav.${navKey(kind)}`)}
          </span>
        }
        subtitle={t(`network.description.${kind}`)}
        actions={
          <Button
            variant="primary"
            disabled={!writable || !projects.data?.length}
            onClick={() => setEditor({ action: "create" })}
          >
            <Plus size={15} />
            {t(kind === "eips" ? "network.allocate" : "common.create")}
          </Button>
        }
      />
      <div className="network-scope notice">
        <Network size={16} />
        <span>{t("network.scopeHint")}</span>
        <Link to="/deployment/server">{t("nav.deployment")}</Link>
      </div>
      <div className="toolbar">
        <RegionFilter />
        <select
          aria-label={t("common.project")}
          value={selectedProjectId}
          onChange={(e) => update("project_id", e.target.value)}
        >
          <option value="">{t("common.allProjects")}</option>
          {projects.data
            ?.filter((p) => !p.deletedAt)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {dt(p.name)} · {formatResourceId("prj", p.id)}
              </option>
            ))}
        </select>
        <input
          className="input search"
          aria-label={t("common.search")}
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => update("q", e.target.value)}
        />
        {kind === "eips" && (
          <select
            aria-label={t("network.bindingFilter")}
            value={bindingFilter}
            onChange={(e) => {
              const binding = e.target.value;
              setParams((old) => {
                const next = new URLSearchParams(old);
                if (binding === "all") next.delete("binding");
                else next.set("binding", binding);
                if (binding === "released") next.set("includeReleased", "true");
                next.delete("drawer");
                return next;
              }, { replace: true });
            }}
          >
            <option value="all">{t("common.all")}</option>
            <option value="available">{t("network.unbound")}</option>
            <option value="bound">{t("network.bound")}</option>
            <option value="released">{t("common.released")}</option>
          </select>
        )}
        {kind === "eips" && (
          <label className="check">
            <input
              type="checkbox"
              checked={includeReleased}
              onChange={(e) => {
                setIncludeReleased(e.target.checked);
                update("includeReleased", e.target.checked ? "true" : "");
              }}
            />
            {t("network.includeReleased")}
          </label>
        )}
        {role !== "billing" && (
          <Link to={`/ops/quotas?region=${region}`}>{t("nav.quotas")}</Link>
        )}
        <Button onClick={() => void q.refetch()}>{t("common.refresh")}</Button>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          <div className="network-summary">
            <span>{t("network.resultCount", { count: items.length })}</span>
            <small>
              {t(`common.${region}`)} ·{" "}
              {selectedProjectId
                ? dt(
                    projects.data?.find((p) => p.id === selectedProjectId)?.name ||
                      selectedProjectId,
                  )
                : t("common.allProjects")}
            </small>
          </div>
          <Panel>
            <DataTable
              pageSizeOptions
              data={items}
              onRow={(r) => update("drawer", r.id)}
              columns={[
                {
                  id: "name",
                  header: t("common.name"),
                  cell: ({ row }) => (
                    <div className="network-identity">
                      <button
                        className="link-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          update("drawer", row.original.id);
                        }}
                      >
                        {dt(row.original.name)}
                      </button>
                      <small className="mono">
                        {networkDisplayId(kind, row.original)}
                      </small>
                    </div>
                  ),
                },
                {
                  id: "status",
                  header: t("common.status"),
                  cell: ({ row }) => <NetworkStatus item={row.original} />,
                },
                {
                  id: "scope",
                  header: t("common.project"),
                  cell: ({ row }) => {
                    const project = projects.data?.find(
                      (p) => p.id === row.original.projectId,
                    );
                    const projectName = dt(
                      project?.name || formatResourceId("prj", row.original.projectId),
                    );
                    return kind === "eips" ? (
                      <div className="eip-project-cell">
                        <span>{projectName}</span>
                        <small className="mono">
                          {formatResourceId("prj", row.original.projectId)}
                        </small>
                      </div>
                    ) : projectName;
                  },
                },
                ...(kind === "vpcs"
                  ? [
                      {
                        id: "networkType",
                        header: t("network.vpcType"),
                        cell: ({
                          row,
                        }: {
                          row: { original: NetworkRecord };
                        }) =>
                          vpcNetworkType(row.original as Vpc) === "baremetal"
                            ? t("network.vpcTypeBaremetal")
                            : t("network.vpcTypeStandard"),
                      },
                      {
                        id: "cidr",
                        header: t("network.cidr"),
                        cell: ({
                          row,
                        }: {
                          row: { original: NetworkRecord };
                        }) =>
                          "cidr" in row.original ? (
                            <code>{row.original.cidr}</code>
                          ) : (
                            "—"
                          ),
                      },
                      {
                        accessorKey: "subnetCount",
                        header: t("network.subnets"),
                      },
                      {
                        accessorKey: "interfaceCount",
                        header: t("network.interfaces"),
                      },
                    ]
                  : kind === "eips"
                    ? [
                        {
                          id: "address",
                          header: t("network.eip"),
                          cell: ({
                            row,
                          }: {
                            row: { original: NetworkRecord };
                          }) =>
                            "address" in row.original ? (
                              <span className="mono">
                                {row.original.address}
                              </span>
                            ) : (
                              "—"
                            ),
                        },
                        {
                          id: "binding",
                          header: t("network.binding"),
                          cell: ({ row }: { row: { original: NetworkRecord } }) =>
                            row.original.boundHref ? (
                              <Link onClick={(event) => event.stopPropagation()} to={row.original.boundHref}>
                                {dt(row.original.boundName || "")}
                              </Link>
                            ) : t("network.unbound"),
                        },
                        {
                          id: "region",
                          header: t("common.region"),
                          cell: ({ row }: { row: { original: NetworkRecord } }) => t(`common.${row.original.region}`),
                        },
                        {
                          id: "rate",
                          header: t("common.hourly"),
                          cell: ({
                            row,
                          }: {
                            row: { original: NetworkRecord };
                          }) => unitMoney(row.original.hourly || 0),
                        },
                      ]
                    : kind === "security-groups"
                      ? [
                          {
                            id: "vpc",
                            header: t("network.vpc"),
                            cell: ({
                              row,
                            }: {
                              row: { original: NetworkRecord };
                            }) =>
                              "vpcId" in row.original ? (
                                <Link
                                  onClick={(e) => e.stopPropagation()}
                                  to={`/network/vpcs?drawer=${row.original.vpcId}`}
                                >
                                  {row.original.vpcId}
                                </Link>
                              ) : (
                                "—"
                              ),
                          },
                          {
                            id: "rules",
                            header: t("network.rules"),
                            cell: ({
                              row,
                            }: {
                              row: { original: NetworkRecord };
                            }) =>
                              "rules" in row.original
                                ? row.original.rules.length
                                : "—",
                          },
                          {
                            accessorKey: "interfaceCount",
                            header: t("network.interfaces"),
                          },
                        ]
                      : [
                          {
                            accessorKey: "gatewayIp",
                            header: t("network.gateway"),
                          },
                          {
                            id: "peer",
                            header: t("network.peer"),
                            cell: ({
                              row,
                            }: {
                              row: { original: NetworkRecord };
                            }) =>
                              "peerIp" in row.original
                                ? row.original.peerIp
                                : "—",
                          },
                          {
                            id: "route",
                            header: t("network.routes"),
                            cell: ({
                              row,
                            }: {
                              row: { original: NetworkRecord };
                            }) =>
                              "localCidr" in row.original ? (
                                <span className="mono">
                                  {row.original.localCidr} →{" "}
                                  {row.original.remoteCidr}
                                </span>
                              ) : (
                                "—"
                              ),
                          },
                        ]),
                {
                  id: "action",
                  header: t("common.actions"),
                  cell: ({ row }) => (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        update("drawer", row.original.id);
                      }}
                    >
                      {t("common.manage")}
                    </Button>
                  ),
                },
              ]}
            />
          </Panel>
          {kind === "eips" && (
            <div className="notice">{t("network.eipRetention")}</div>
          )}
          {kind === "tunnels" && (
            <div className="notice">{t("network.tunnelHint")}</div>
          )}
        </>
      )}
      {id && (
        <NetworkDrawer
          key={`${kind}-${id}`}
          kind={kind}
          id={id}
          onClose={() => update("drawer", "")}
          onEdit={setEditor}
          writable={writable}
        />
      )}
      {editor && (
        <NetworkEditor
          key={`${editor.action}-${editor.item?.id || "new"}-${editor.rule?.id || "new"}`}
          kind={kind}
          state={editor}
          region={region}
          projectId={selectedProjectId}
          projects={(projects.data || []).filter((p) => !p.deletedAt)}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
function networkDisplayId(kind: NetworkKind, item: NetworkRecord): string {
  if (kind === "vpcs")
    return formatResourceId("vpc", item.id, {
      baremetalVpc: vpcNetworkType(item as Vpc) === "baremetal",
    });
  if (kind === "eips") return formatResourceId("eip", item.id);
  if (kind === "security-groups") return formatResourceId("sgr", item.id);
  return formatResourceId("tun", item.id);
}

function NetworkStatus({ item }: { item: NetworkRecord }) {
  const released =
    ("releasedAt" in item && !!item.releasedAt) || !!item.deletedAt;
  const label = released
    ? t("common.released")
    : "enabled" in item
      ? t(item.enabled ? "network.enabled" : "network.disabled")
      : "interfaceId" in item
        ? t(
            item.interfaceId || item.tunnelId
              ? "network.bound"
              : "network.unbound",
          )
        : t("network.available");
  return (
    <Badge
      status={
        released
          ? "released"
          : "enabled" in item && !item.enabled
            ? "stopped"
            : "active"
      }
      label={label}
    />
  );
}
function NetworkDrawer({
  kind,
  id,
  onClose,
  onEdit,
  writable,
}: {
  kind: NetworkKind;
  id: string;
  onClose: () => void;
  onEdit: (s: EditorState) => void;
  writable: boolean;
}) {
  const path = `${EP.network}/${kind}/${id}`;
  const q = useData<NetworkDetail>(["network-detail", kind, id], path);
  const [tab, setTab] = useState("overview");
  const [release, setRelease] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { run, busy } = useAction();
  const d = q.data;
  const linkedVpcId = d && "vpcId" in d ? d.vpcId : "";
  const linkedVpc = useData<Vpc>(
    ["network-vpc-display", linkedVpcId],
    `${EP.network}/vpcs/${linkedVpcId}`,
    { enabled: !!linkedVpcId },
  );
  const linkedVpcDisplayId = linkedVpcId
    ? formatResourceId("vpc", linkedVpcId, {
        baremetalVpc: linkedVpc.data
          ? vpcNetworkType(linkedVpc.data) === "baremetal"
          : /(^|[-_])bm([-_]|$)/i.test(linkedVpcId),
      })
    : "";
  const dead = d && (!!d.deletedAt || ("releasedAt" in d && !!d.releasedAt));
  const allowed = writable && !dead && !busy;
  const action = async (
    task: () => Promise<unknown>,
    message: string,
    close = false,
  ) => {
    if (!(await confirmAction(message))) return;
    const result = await run(async () => {
      await task();
      return true;
    });
    if (result && close) onClose();
  };
  const tabs =
    kind === "vpcs"
      ? ["overview", "subnets", "bindings", "routes", "events"]
      : kind === "security-groups"
        ? ["overview", "inbound", "outbound", "bindings", "events"]
        : kind === "eips"
          ? ["overview", "usage", "events"]
          : ["overview", "routes", "events"];
  return (
    <>
      <Modal
        open
        onClose={onClose}
        drawer
        title={
          d ? (
            <span className="row">
              {dt(d.name)}
              <NetworkStatus item={d} />
            </span>
          ) : (
            t("common.details")
          )
        }
        description={
          d
            ? `${networkDisplayId(kind, d)} · ${t(`common.${d.region}`)}`
            : undefined
        }
      >
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          d && (
            <div className="stack">
              {kind === "eips" && "address" in d && (
                <div className="network-eip-hero">
                  <div>
                    <small>{t("network.eip")}</small>
                    <strong className="mono">{d.address}</strong>
                    <span>{dt(d.name)} · {networkDisplayId(kind, d)}</span>
                  </div>
                  <div className="row">
                    <NetworkStatus item={d} />
                    <CopyButton value={d.address} />
                    <CopyButton value={networkDisplayId(kind, d)} />
                  </div>
                </div>
              )}
              {dead ? (
                <p className="notice">{t("resource.history")}</p>
              ) : (
                <div className="row network-actions">
                  <Button
                    disabled={!allowed}
                    onClick={() => onEdit({ action: "edit", item: d })}
                  >
                    {t("common.edit")}
                  </Button>
                  {kind === "vpcs" && (
                    <Button
                      disabled={!allowed}
                      onClick={() => onEdit({ action: "subnet", item: d })}
                    >
                      {t("network.addSubnet")}
                    </Button>
                  )}
                  {kind === "security-groups" && (
                    <>
                      <Button
                        disabled={!allowed}
                        onClick={() => onEdit({ action: "rule", item: d })}
                      >
                        {t("network.addRule")}
                      </Button>
                      <Button
                        disabled={!allowed}
                        onClick={() => onEdit({ action: "associate", item: d })}
                      >
                        {t("network.associate")}
                      </Button>
                    </>
                  )}
                  {kind === "eips" && "interfaceId" in d && (
                    <>
                      <Button
                        disabled={!allowed || !!d.interfaceId || !!d.tunnelId}
                        onClick={() => onEdit({ action: "bind", item: d })}
                      >
                        {t("network.bind")}
                      </Button>
                      <Button
                        disabled={!allowed || !d.interfaceId || !!d.tunnelId}
                        onClick={() =>
                          void action(
                            () => post(path + "/unbind", {}),
                            t("network.unbindConfirm"),
                          )
                        }
                      >
                        {t("network.unbind")}
                      </Button>
                    </>
                  )}
                  {kind === "tunnels" && "enabled" in d && (
                    <>
                      <Button
                        disabled={!allowed}
                        onClick={() =>
                          void action(
                            () => patch(path, { enabled: !d.enabled }),
                            t(
                              d.enabled
                                ? "network.disableConfirm"
                                : "network.enableConfirm",
                            ),
                          )
                        }
                      >
                        {t(d.enabled ? "network.disable" : "network.enable")}
                      </Button>
                      <Button
                        disabled={!allowed}
                        onClick={() => onEdit({ action: "psk", item: d })}
                      >
                        {t("network.rotatePsk")}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="danger"
                    disabled={
                      !allowed ||
                      ("isDefault" in d && d.isDefault) ||
                      ("enabled" in d && d.enabled) ||
                      ("interfaceId" in d && !!(d.interfaceId || d.tunnelId))
                    }
                    onClick={() =>
                      kind === "eips"
                        ? setRelease(true)
                        : void action(
                            () => remove(path),
                            t("network.deleteConfirm"),
                            true,
                          )
                    }
                  >
                    {t(kind === "eips" ? "network.release" : "common.delete")}
                  </Button>
                </div>
              )}
              {kind === "eips" && "interfaceId" in d && (d.interfaceId || d.tunnelId) && (
                <p className="notice">{t(d.tunnelId ? "network.eipTunnelReleaseBlocked" : "network.eipReleaseBlocked")}</p>
              )}
              <Tabs
                items={tabs.map((id) => ({
                  id,
                  label: t(
                    ["overview", "events"].includes(id)
                      ? `tab.${id}`
                      : `network.${id}`,
                  ),
                }))}
                value={tab}
                onChange={setTab}
              />
              {tab === "overview" ? (
                <>
                  <Panel title={t("network.basic")}>
                    <KeyValues
                      items={[
                        [t("common.name"), dt(d.name)],
                        [
                          "ID",
                          <span className="mono">
                            {networkDisplayId(kind, d)}
                            <CopyButton value={networkDisplayId(kind, d)} />
                          </span>,
                        ],
                        [t("common.region"), t(`common.${d.region}`)],
                        [t("common.createdAt"), date(d.createdAt)],
                        ...("cidr" in d
                          ? [[t("network.cidr"), d.cidr] as [string, string]]
                          : []),
                        ...("vpcId" in d
                          ? [
                              [
                                t("network.vpc"),
                                <Link to={`/network/vpcs?drawer=${d.vpcId}`}>
                                  {linkedVpcDisplayId}
                                </Link>,
                              ] as [string, React.ReactNode],
                            ]
                          : []),
                        ...("address" in d
                          ? [
                              [
                                t("network.eip"),
                                <span className="mono">
                                  {d.address}
                                  <CopyButton value={d.address} />
                                </span>,
                              ] as [string, React.ReactNode],
                              [
                                t("network.bandwidth"),
                                `${d.bandwidthMbps} Mbps`,
                              ] as [string, string],
                              [
                                t("common.hourly"),
                                unitMoney(d.hourly || 0),
                              ] as [string, string],
                              [
                                t("network.binding"),
                                d.boundHref ? <Link to={d.boundHref}>{dt(d.boundName || "")}</Link> : t("network.unbound"),
                              ] as [string, React.ReactNode],
                              ...(d.tunnelId
                                ? [
                                    [
                                      t("network.tunnels"),
                                      <Link
                                        to={`/network/tunnels?drawer=${d.tunnelId}`}
                                      >
                                        {formatResourceId("tun", d.tunnelId)}
                                      </Link>,
                                    ] as [string, React.ReactNode],
                                  ]
                                : []),
                            ]
                          : []),
                        ...("intraGroupPolicy" in d
                          ? [
                              [
                                t("network.intra"),
                                t(`network.${d.intraGroupPolicy}`),
                              ] as [string, string],
                            ]
                          : []),
                        ...("peerIp" in d
                          ? [
                              [t("network.gateway"), d.gatewayIp || "—"] as [
                                string,
                                string,
                              ],
                              [t("network.peer"), d.peerIp] as [string, string],
                              [t("network.privateIp"), d.privateIp] as [
                                string,
                                string,
                              ],
                              [
                                t("network.eip"),
                                <Link to={`/network/eips?drawer=${d.eipId}`}>
                                  {d.gatewayIp || formatResourceId("eip", d.eipId)}
                                </Link>,
                              ] as [string, React.ReactNode],
                              [
                                t("network.crypto"),
                                "IKEv2 · AES-256 · SHA-256",
                              ] as [string, string],
                              [
                                t("network.psk"),
                                t("network.pskConfigured"),
                              ] as [string, string],
                            ]
                          : []),
                      ]}
                    />
                  </Panel>
                  {kind === "vpcs" && (
                    <div className="network-topology">
                      <Network size={25} />
                      <strong>
                        {dt(d.name)} · {"cidr" in d && d.cidr}
                      </strong>
                      <span>↓</span>
                      <div className="row">
                        {d.subnets?.map((s) => (
                          <span className="chip mono" key={s.id}>
                            {s.name} · {s.cidr}
                          </span>
                        ))}
                      </div>
                      <small>{t("network.topologyHint")}</small>
                    </div>
                  )}
                  {kind === "eips" && (
                    <p className="notice">{t("network.eipRetention")}</p>
                  )}
                  {kind === "security-groups" && (
                    <p className="notice">{t("network.ruleHint")}</p>
                  )}
                  {kind === "tunnels" && (
                    <p className="notice">{t("network.tunnelHint")}</p>
                  )}
                </>
              ) : tab === "subnets" ? (
                <SubnetTable
                  data={d.subnets || []}
                  writable={!!allowed}
                  onDelete={(s) =>
                    void action(
                      () => remove(`${EP.network}/subnets/${s.id}`),
                      t("network.deleteConfirm"),
                    )
                  }
                />
              ) : ["inbound", "outbound"].includes(tab) && "rules" in d ? (
                <RuleTable
                  data={d.rules.filter((r) => r.direction === tab)}
                  writable={!!allowed}
                  onEdit={(r) => onEdit({ action: "rule", item: d, rule: r })}
                  onDelete={(r) =>
                    void action(
                      () => remove(path + `/rules/${r.id}`),
                      t("network.deleteRuleConfirm"),
                    )
                  }
                />
              ) : tab === "bindings" ? (
                <>
                  <InterfaceTable data={d.interfaces || []} />
                  {kind === "security-groups" && (
                    <div className="stack">
                      {[
                        ...new Set(
                          d.interfaces
                            ?.filter((i) => i.kind === "gpu_vm")
                            .map((i) => i.resourceUuid),
                        ),
                      ].map((uuid) => (
                        <div className="between" key={uuid}>
                          <code>{uuid}</code>
                          <Button
                            disabled={!allowed}
                            onClick={() =>
                              void action(
                                () =>
                                  post(path + "/associate", {
                                    resourceUuid: uuid,
                                    remove: true,
                                  }),
                                t("network.detachConfirm"),
                              )
                            }
                          >
                            {t("network.detach")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : tab === "routes" ? (
                <Panel title={t("network.routes")}>
                  <KeyValues
                    items={
                      "localCidr" in d
                        ? [
                            [t("network.localCidr"), d.localCidr],
                            [t("network.remoteCidr"), d.remoteCidr],
                            [t("network.nextHop"), d.gatewayIp],
                            [
                              t("common.status"),
                              t(
                                d.enabled
                                  ? "network.enabled"
                                  : "network.disabled",
                              ),
                            ],
                          ]
                        : [
                            [
                              t("network.localRoute"),
                              "cidr" in d ? d.cidr : "—",
                            ],
                            [t("network.nextHop"), t("network.local")],
                          ]
                    }
                  />
                  {d.tunnels?.map((tunnel) => (
                    <p key={tunnel.id}>
                      <Link to={`/network/tunnels?drawer=${tunnel.id}`}>
                        {tunnel.name}
                      </Link>{" "}
                      · <code>{tunnel.remoteCidr}</code> ·{" "}
                      {t(
                        tunnel.enabled ? "network.enabled" : "network.disabled",
                      )}
                    </p>
                  ))}
                </Panel>
              ) : tab === "usage" ? (
                <DataTable<Usage>
                  data={d.usage || []}
                  columns={[
                    {
                      accessorKey: "usageHour",
                      header: t("common.time"),
                      cell: ({ row }) => date(row.original.usageHour),
                    },
                    {
                      accessorKey: "amount",
                      header: t("common.amount"),
                      cell: ({ row }) => money(row.original.amount),
                    },
                  ]}
                />
              ) : (
                <DataTable
                  data={d.audit || []}
                  columns={[
                    {
                      accessorKey: "at",
                      header: t("common.time"),
                      cell: ({ row }) => date(row.original.at),
                    },
                    {
                      accessorKey: "action",
                      header: t("common.actions"),
                      cell: ({ row }) =>
                        t(`network.audit.${row.original.action}`),
                    },
                    { accessorKey: "actor", header: t("network.actor") },
                  ]}
                />
              )}
            </div>
          )
        )}
      </Modal>
      <Modal
        open={release}
        onClose={() => setRelease(false)}
        title={t("network.release")}
        description={t("network.releaseHint")}
      >
        <div className="stack">
          <Field
            label={t("network.releaseInput", {
              id: d && "displayId" in d ? d.displayId : "",
            })}
          >
            <input
              className="input"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            disabled={
              !d || !("displayId" in d) || confirm !== d.displayId || busy
            }
            onClick={async () => {
              const result = await run(() => remove(path + query({ confirm })));
              if (result) {
                setRelease(false);
                onClose();
              }
            }}
          >
            {t("network.release")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
function SubnetTable({
  data,
  writable,
  onDelete,
}: {
  data: SubnetView[];
  writable: boolean;
  onDelete: (s: SubnetView) => void;
}) {
  return (
    <DataTable
      data={data}
      columns={[
        { accessorKey: "name", header: t("common.name") },
        { accessorKey: "cidr", header: t("network.cidr") },
        { accessorKey: "zone", header: t("network.zone") },
        { accessorKey: "usedIps", header: t("network.usedIps") },
        {
          accessorKey: "availableIps",
          header: t("network.availableIps"),
          cell: ({ row }) => number(row.original.availableIps),
        },
        {
          id: "action",
          header: t("common.actions"),
          cell: ({ row }) => (
            <Button
              variant="danger"
              disabled={!writable || row.original.usedIps > 0}
              onClick={() => onDelete(row.original)}
            >
              {t("common.delete")}
            </Button>
          ),
        },
      ]}
    />
  );
}
function RuleTable({
  data,
  writable,
  onEdit,
  onDelete,
}: {
  data: SecurityRule[];
  writable: boolean;
  onEdit: (r: SecurityRule) => void;
  onDelete: (r: SecurityRule) => void;
}) {
  return (
    <>
      <div className="notice">{t("network.ruleHint")}</div>
      <DataTable
        data={[...data].sort(
          (a, b) => a.priority - b.priority || (a.action === "deny" ? -1 : 1),
        )}
        columns={[
          { accessorKey: "priority", header: t("network.priority") },
          {
            accessorKey: "action",
            header: t("network.policy"),
            cell: ({ row }) => (
              <Badge
                status={row.original.action === "allow" ? "active" : "error"}
                label={t(`network.${row.original.action}`)}
              />
            ),
          },
          { accessorKey: "protocol", header: t("network.protocol") },
          { accessorKey: "cidr", header: t("network.sourceCidr") },
          {
            id: "ports",
            header: t("network.ports"),
            cell: ({ row }) =>
              row.original.portFrom === null
                ? "ALL"
                : `${row.original.portFrom}–${row.original.portTo}`,
          },
          { accessorKey: "description", header: t("common.description") },
          {
            id: "actions",
            header: t("common.actions"),
            cell: ({ row }) => (
              <div className="row">
                <Button
                  disabled={!writable}
                  onClick={() => onEdit(row.original)}
                >
                  {t("common.edit")}
                </Button>
                <Button
                  disabled={!writable}
                  variant="danger"
                  onClick={() => onDelete(row.original)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
export function InterfaceTable({ data }: { data: InterfaceView[] }) {
  return (
    <DataTable
      data={data}
      columns={[
        {
          accessorKey: "name",
          header: t("network.interface"),
          cell: ({ row }) =>
            row.original.resource ? (
              <Link to={resourceLink(row.original.resource)}>
                {row.original.name}
              </Link>
            ) : (
              row.original.name
            ),
        },
        { accessorKey: "privateIp", header: t("network.privateIp") },
        {
          id: "subnet",
          header: t("network.subnet"),
          cell: ({ row }) => (
            <Link to={`/network/vpcs?drawer=${row.original.vpcId}`}>
              {row.original.subnet?.name || row.original.subnetId}
            </Link>
          ),
        },
        {
          id: "groups",
          header: t("network.groups"),
          cell: ({ row }) => (
            <div className="stack">
              {row.original.securityGroupIds.map((id) => (
                <Link key={id} to={`${uiPath("security-groups")}?drawer=${id}`}>
                  {row.original.groups?.find((g) => g.id === id)?.name || formatResourceId("sgr", id)}
                </Link>
              ))}
            </div>
          ),
        },
        {
          id: "eip",
          header: t("network.eip"),
          cell: ({ row }) =>
            row.original.eip ? (
              <Link to={`/network/eips?drawer=${row.original.eip.id}`}>
                {row.original.eip.address}
              </Link>
            ) : (
              "—"
            ),
        },
        {
          id: "status",
          header: t("common.status"),
          cell: ({ row }) => (
            <Badge
              status={row.original.releasedAt ? "released" : "active"}
              label={t(
                row.original.releasedAt
                  ? "common.released"
                  : "network.retained",
              )}
            />
          ),
        },
      ]}
    />
  );
}
