import { useState } from "react";
import type { Region, Project } from "../../types/domain";
import type {
  DeploymentNetworkOptions,
  SecurityRule,
} from "../../types/network";
import { EP, post, patch, query } from "../../lib/api-client";
import { useData, useAction } from "../shared/hooks";
import { t, dt } from "../../i18n";
import { Modal, Field, Button, Loading, ErrorState } from "../../components/ui";
import type { NetworkKind, NetworkDetail, InterfaceView } from "./model";
export type EditorAction =
  "create" | "edit" | "subnet" | "rule" | "bind" | "associate" | "psk";
export interface EditorState {
  action: EditorAction;
  item?: NetworkDetail;
  rule?: SecurityRule;
}
export function NetworkEditor({
  kind,
  state,
  region,
  projectId,
  projects,
  onClose,
}: {
  kind: NetworkKind;
  state: EditorState;
  region: Region;
  projectId: string;
  projects: Project[];
  onClose: () => void;
}) {
  const item = state.item;
  const action = state.action;
  const [project, setProject] = useState(
    item?.projectId || projectId || projects[0]?.id || "",
  );
  const [name, setName] = useState(action === "subnet" ? "" : item?.name || "");
  const [networkType, setNetworkType] = useState<"standard" | "baremetal">(
    item && "networkType" in item && item.networkType === "baremetal"
      ? "baremetal"
      : "standard",
  );
  const [cidr, setCidr] = useState(
    "cidr" in (item || {}) ? (item as { cidr: string }).cidr : "10.100.0.0/16",
  );
  const [vpcId, setVpcId] = useState(item && "vpcId" in item ? item.vpcId : "");
  const [subnetId, setSubnetId] = useState("");
  const [zone, setZone] = useState(`${region}-a`);
  const [eipId, setEipId] = useState("");
  const [binding, setBinding] = useState("");
  const [bandwidth, setBandwidth] = useState(
    item && "bandwidthMbps" in item ? item.bandwidthMbps : 100,
  );
  const [description, setDescription] = useState(
    item && "description" in item ? item.description : "",
  );
  const [intra, setIntra] = useState(
    item && "intraGroupPolicy" in item ? item.intraGroupPolicy : "allow",
  );
  const [peer, setPeer] = useState("");
  const [local, setLocal] = useState("");
  const [remote, setRemote] = useState("192.168.0.0/16");
  const [psk, setPsk] = useState("");
  const [rule, setRule] = useState<Omit<SecurityRule, "id">>(
    state.rule || {
      direction: "inbound",
      action: "allow",
      protocol: "tcp",
      cidr: "0.0.0.0/0",
      portFrom: 443,
      portTo: 443,
      priority: 1,
      description: "HTTPS",
    },
  );
  const scopeRegion = item?.region || region;
  const options = useData<DeploymentNetworkOptions>(
    ["network-editor-options", scopeRegion, project],
    EP.options + query({ region: scopeRegion, project_id: project }),
  );
  const nics = useData<InterfaceView[]>(
    ["network-editor-nics", scopeRegion, project],
    `${EP.network}/interfaces` +
      query({ region: scopeRegion, project_id: project }),
    { enabled: action === "bind" || action === "associate" },
  );
  const { run, busy } = useAction();
  const optionsData = options.data;
  const vpc =
    optionsData?.vpcs.find((v) => v.id === vpcId) || optionsData?.vpcs[0];
  const subnet = vpc?.subnets.find((s) => s.id === subnetId) || vpc?.subnets[0];
  const apiPath = `${EP.network}/${kind}${item ? `/${item.id}` : ""}`;
  const input = (
    label: string,
    value: string,
    set: (s: string) => void,
    type = "text",
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      <input
        className="input"
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete={type === "password" ? "new-password" : "off"}
        required={label !== t("common.description")}
      />
    </Field>
  );
  const select = (
    label: string,
    value: string,
    set: (s: string) => void,
    values: [string, string][],
  ) => (
    <Field label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        required
      >
        <option value="" disabled>
          {t("network.select")}
        </option>
        {values.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
  const submit = async () => {
    let path = apiPath;
    let body: Record<string, unknown> = {
      projectId: project,
      region: scopeRegion,
      name,
    };
    let edit =
      action === "edit" ||
      action === "psk" ||
      (action === "rule" && !!state.rule);
    if (action === "subnet") {
      path = `${EP.network}/subnets`;
      body = { ...body, vpcId: item!.id, cidr, zone };
    } else if (action === "rule") {
      path += `/rules${state.rule ? `/${state.rule.id}` : ""}`;
      body = { ...rule };
    } else if (action === "bind") {
      path += "/bind";
      body = { interfaceId: binding };
    } else if (action === "associate") {
      path += "/associate";
      body = { resourceUuid: binding };
    } else if (action === "psk") body = { psk };
    else if (kind === "vpcs") body = { ...body, cidr, networkType };
    else if (kind === "eips") body = { ...body, bandwidthMbps: bandwidth };
    else if (kind === "security-groups")
      body = { ...body, vpcId: vpc?.id, description, intraGroupPolicy: intra };
    else if (action === "edit") body = { name };
    else
      body = {
        ...body,
        vpcId: vpc?.id,
        subnetId: subnet?.id,
        eipId,
        peerIp: peer,
        localCidr: local || vpc?.cidr,
        remoteCidr: remote,
        psk,
      };
    edit = !!edit;
    const result = await run(() =>
      edit ? patch<object>(path, body) : post<object>(path, body),
    );
    if (result) {
      setPsk("");
      onClose();
    }
  };
  const needsOptions =
    action === "create" && ["security-groups", "tunnels"].includes(kind);
  const bindingNics = (nics.data || []).filter(
    (i) =>
      i.kind === "gpu_vm" &&
      i.resource &&
      ["running", "stopped"].includes(i.resource.status) &&
      (action === "associate"
        ? i.vpcId === (item && "vpcId" in item ? item.vpcId : "") &&
          !i.securityGroupIds.includes(item!.id)
        : !i.eip),
  );
  const uniqueResources = [
    ...new Map(bindingNics.map((i) => [i.resourceUuid, i])).values(),
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={t(`network.action.${action}`)}
      description={action === "psk" ? t("network.pskHint") : undefined}
    >
      <form
        className="stack network-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {needsOptions && options.isPending ? (
          <Loading />
        ) : options.error ? (
          <ErrorState error={options.error} />
        ) : (
          <>
            {action === "create" && (
              <div className="grid grid-2">
                {select(
                  t("common.project"),
                  project,
                  setProject,
                  projects.map((p) => [p.id, dt(p.name)]),
                )}
                <Field label={t("common.region")}>
                  <input
                    className="input"
                    value={t(`common.${scopeRegion}`)}
                    readOnly
                  />
                </Field>
              </div>
            )}
            {["create", "edit", "subnet"].includes(action) &&
              input(t("common.name"), name, setName)}
            {action === "subnet" && (
              <>
                {input(
                  t("network.cidr"),
                  cidr,
                  setCidr,
                  "text",
                  t("network.subnetHint"),
                )}
                {select(
                  t("network.zone"),
                  zone,
                  setZone,
                  ["a", "b"].map((z) => [
                    `${scopeRegion}-${z}`,
                    `${t(`common.${scopeRegion}`)} ${z.toUpperCase()}`,
                  ]),
                )}
              </>
            )}
            {action === "create" &&
              kind === "vpcs" &&
              select(
                t("network.vpcType"),
                networkType,
                (value) => setNetworkType(value as "standard" | "baremetal"),
                [
                  ["standard", t("network.vpcTypeStandard")],
                  ["baremetal", t("network.vpcTypeBaremetal")],
                ],
              )}
            {action === "create" &&
              kind === "vpcs" &&
              input(
                t("network.cidr"),
                cidr,
                setCidr,
                "text",
                t("network.vpcHint"),
              )}
            {action === "create" &&
              ["security-groups", "tunnels"].includes(kind) &&
              select(
                t("network.vpc"),
                vpc?.id || "",
                (id) => {
                  setVpcId(id);
                  setSubnetId("");
                },
                (optionsData?.vpcs || []).map((v) => [
                  v.id,
                  `${dt(v.name)} · ${v.cidr}`,
                ]),
              )}
            {["create", "edit"].includes(action) && kind === "eips" && (
              <Field
                label={t("network.bandwidth")}
                hint={t("network.bandwidthHint")}
              >
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={1000}
                  value={bandwidth}
                  onChange={(e) => setBandwidth(Number(e.target.value))}
                />
              </Field>
            )}
            {["create", "edit"].includes(action) &&
              kind === "security-groups" && (
                <>
                  {input(t("common.description"), description, setDescription)}
                  {select(
                    t("network.intra"),
                    intra,
                    (v) => setIntra(v as "allow" | "deny"),
                    ["allow", "deny"].map((v) => [v, t(`network.${v}`)]),
                  )}
                </>
              )}
            {action === "create" && kind === "tunnels" && (
              <>
                {select(
                  t("network.subnet"),
                  subnet?.id || "",
                  setSubnetId,
                  (vpc?.subnets || []).map((s) => [
                    s.id,
                    `${dt(s.name)} · ${s.cidr}`,
                  ]),
                )}
                {select(
                  t("network.eip"),
                  eipId,
                  setEipId,
                  (optionsData?.eips || []).map((e) => [
                    e.id,
                    `${e.address} · ${dt(e.name)}`,
                  ]),
                )}
                {!optionsData?.eips.length && (
                  <p className="notice">{t("network.allocateFirst")}</p>
                )}
                {input(t("network.peer"), peer, setPeer)}
                {input(
                  t("network.localCidr"),
                  local || vpc?.cidr || "",
                  setLocal,
                )}
                {input(t("network.remoteCidr"), remote, setRemote)}
                <div className="notice">{t("network.tunnelHint")}</div>
              </>
            )}
            {((kind === "tunnels" && action === "create") ||
              action === "psk") && (
              <Field label={t("network.psk")} hint={t("network.pskHint")}>
                <input
                  className="input"
                  aria-label={t("network.psk")}
                  type="password"
                  autoComplete="new-password"
                  value={psk}
                  minLength={16}
                  maxLength={128}
                  required
                  onChange={(e) => setPsk(e.target.value)}
                />
              </Field>
            )}
            {action === "rule" && (
              <>
                <div className="row">
                  {[22, 80, 443].map((port) => (
                    <Button
                      key={port}
                      onClick={() =>
                        setRule({
                          ...rule,
                          protocol: "tcp",
                          portFrom: port,
                          portTo: port,
                          description:
                            port === 22
                              ? "SSH"
                              : port === 80
                                ? "HTTP"
                                : "HTTPS",
                        })
                      }
                    >
                      {port === 22 ? "SSH" : port === 80 ? "HTTP" : "HTTPS"}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-2">
                  {select(
                    t("network.direction"),
                    rule.direction,
                    (v) =>
                      setRule({
                        ...rule,
                        direction: v as SecurityRule["direction"],
                      }),
                    ["inbound", "outbound"].map((v) => [v, t(`network.${v}`)]),
                  )}
                  {select(
                    t("network.policy"),
                    rule.action,
                    (v) =>
                      setRule({ ...rule, action: v as SecurityRule["action"] }),
                    ["allow", "deny"].map((v) => [v, t(`network.${v}`)]),
                  )}
                  {select(
                    t("network.protocol"),
                    rule.protocol,
                    (v) =>
                      setRule({
                        ...rule,
                        protocol: v as SecurityRule["protocol"],
                        portFrom: ["tcp", "udp"].includes(v) ? 443 : null,
                        portTo: ["tcp", "udp"].includes(v) ? 443 : null,
                      }),
                    ["all", "tcp", "udp", "icmp"].map((v) => [
                      v,
                      v.toUpperCase(),
                    ]),
                  )}
                  <Field label={t("network.priority")}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={rule.priority}
                      onChange={(e) =>
                        setRule({ ...rule, priority: Number(e.target.value) })
                      }
                    />
                  </Field>
                  {input(t("network.sourceCidr"), rule.cidr, (v) =>
                    setRule({ ...rule, cidr: v }),
                  )}
                  {["tcp", "udp"].includes(rule.protocol) && (
                    <>
                      {input(
                        t("network.portFrom"),
                        String(rule.portFrom || ""),
                        (v) => setRule({ ...rule, portFrom: Number(v) }),
                        "number",
                      )}
                      {input(
                        t("network.portTo"),
                        String(rule.portTo || ""),
                        (v) => setRule({ ...rule, portTo: Number(v) }),
                        "number",
                      )}
                    </>
                  )}
                  {input(t("common.description"), rule.description, (v) =>
                    setRule({ ...rule, description: v }),
                  )}
                </div>
                <div className="notice">{t("network.ruleHint")}</div>
              </>
            )}
            {["bind", "associate"].includes(action) &&
              (nics.isPending ? (
                <Loading />
              ) : nics.error ? (
                <ErrorState error={nics.error} />
              ) : (
                <>
                  {select(
                    t(
                      action === "bind" ? "network.interface" : "nav.resources",
                    ),
                    binding,
                    setBinding,
                    (action === "bind" ? bindingNics : uniqueResources).map(
                      (i) => [
                        action === "bind" ? i.id : i.resourceUuid,
                        `${dt(i.resource!.name)} · ${i.name} · ${i.privateIp}`,
                      ],
                    ),
                  )}
                  {action === "associate" && (
                    <p className="notice">{t("network.associateHint")}</p>
                  )}
                  {!bindingNics.length && <p>{t("network.noEligible")}</p>}
                </>
              ))}
            <div className="dialog-actions">
              <Button onClick={onClose}>{t("common.cancel")}</Button>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  busy ||
                  (needsOptions && !vpc) ||
                  (["bind", "associate"].includes(action) && !binding) ||
                  (kind === "tunnels" &&
                    action === "create" &&
                    (!eipId || !subnet))
                }
              >
                {t("common.confirm")}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
