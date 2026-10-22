import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import type { DeploymentOptions, Pool, Image, VgpuSpec } from "../../types/domain";
import { cidrContains, cidrOverlaps, cidrRange, ipv4String, privateCidr, subnetCapacity, suggestedClusterCidrs, vpcNetworkType } from "../../lib/network";
import { EP, post, query } from "../../lib/api-client";
import { formatResourceId } from "../../lib/ids";
import { storageSelectionsSchema, nodePoolSchema, vgpuSchema, isCidr } from "../../lib/schema";
import { imageSupportsArchitecture, imageSupportsPool } from "./shared/image-compat";
import { t } from "../../i18n";
import { useAuth } from "../../stores/auth";
import { Button, Field, Loading, Panel, KeyValues, ErrorState, Check, Modal } from "../../components/ui";
import { useAction, useData } from "../shared/hooks";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec, SpecCheck, SpecNumber, SpecSelect, SpecText,
  DeploymentOptionSelect, Review, ScalingToggle,
  type FormContext, type WizardValues,
} from "./shared/fields";

const poolName = (pool: VgpuSpec["nodePools"][number], index: number) => pool.name || `gpu-pool-${index + 1}`;
const selectedSubnets = (spec: VgpuSpec) => spec.subnets?.length ? spec.subnets : (spec.subnet ? [spec.subnet] : []);
const cidrProblem = (podCidr: string, serviceCidr: string, blocked: string[]) => {
  if (!cidrRange(podCidr) || !privateCidr(podCidr)) return "eks.invalidPodCidr";
  if (!cidrRange(serviceCidr) || !privateCidr(serviceCidr)) return "eks.invalidServiceCidr";
  if (cidrOverlaps(podCidr, serviceCidr)) return "eks.podServiceOverlap";
  if (blocked.some((cidr) => cidrOverlaps(podCidr, cidr))) return "eks.podVpcOverlap";
  if (blocked.some((cidr) => cidrOverlaps(serviceCidr, cidr))) return "eks.serviceVpcOverlap";
  return "";
};
const vpcSubnetsValid = (vpc: DeploymentOptions["vpcs"][number]) =>
  vpc.subnets.every((subnet) => !!cidrRange(subnet.cidr) && cidrContains(vpc.cidr, subnet.cidr) && cidrRange(subnet.cidr)!.prefix <= 29) &&
  vpc.subnets.every((subnet, index) => vpc.subnets.slice(index + 1).every((other) => !cidrOverlaps(subnet.cidr, other.cidr)));
const requiredIps = (spec: VgpuSpec) => {
  const current = spec.nodePools.reduce((count, pool) => count + pool.nodeCount, 0);
  const peak = spec.scaling ? Math.max(current, spec.scaling.max_size) : current;
  return peak + (spec.controlPlaneTier === "ha" ? 3 : 1);
};
const subnetDemand = (index: number, selectedCount: number, total: number) =>
  Math.floor(total / selectedCount) + (index < total % selectedCount ? 1 : 0);
const plannedSubnets = (cidr: string, region: string) => {
  const range = cidrRange(cidr);
  if (!range || range.prefix > 28) return [{ name: "gpu-a", cidr: "", zone: `${region}-a` }, { name: "gpu-b", cidr: "", zone: `${region}-b` }];
  const prefix = Math.min(29, range.prefix + 4);
  const size = 2 ** (32 - prefix);
  return [{ name: "gpu-a", cidr: `${ipv4String(range.start)}/${prefix}`, zone: `${region}-a` },
    { name: "gpu-b", cidr: `${ipv4String(range.start + size)}/${prefix}`, zone: `${region}-b` }];
};

function validStep(values: WizardValues, step: number, lookups?: { network?: DeploymentOptions; pools: Pool[]; images: Image[] }) {
  const spec = values.spec as VgpuSpec;
  if (step === 0) return ["1.28", "1.29", "1.30", "1.31"].includes(spec.k8sVersion) &&
    ["standard", "ha"].includes(spec.controlPlaneTier) && (!spec.apiServerPublic || isCidr(spec.authorizedCidr));
  if (step === 1) {
    if (spec.apiServerPublic && !isCidr(spec.authorizedCidr)) return false;
    const subnets = selectedSubnets(spec);
    const vpc = lookups?.network?.vpcs.find((item) => item.id === spec.vpc && vpcNetworkType(item) === "standard");
    const chosen = subnets.map((id) => vpc?.subnets.find((item) => item.id === id));
    const count = requiredIps(spec);
    return !!vpc && vpcSubnetsValid(vpc) && subnets.length >= (spec.controlPlaneTier === "ha" ? 2 : 1) &&
      chosen.every((item) => !!item) && new Set(subnets).size === subnets.length && subnets.includes(spec.subnet) &&
      (spec.controlPlaneTier !== "ha" || new Set(chosen.map((item) => item?.zone)).size >= 2) &&
      chosen.every((item, index) => item!.availableIps >= subnetDemand(index, chosen.length, count)) &&
      !cidrProblem(spec.podCidr || "", spec.serviceCidr || "", lookups?.network?.vpcs.filter((item) => item.projectId === values.projectId && item.region === values.region && vpcNetworkType(item) === "standard").map((item) => item.cidr) || [vpc.cidr]) &&
      ["cilium", "calico"].includes(spec.networkPlugin) &&
      !!spec.securityGroups?.length && spec.securityGroups.every((id) => lookups?.network?.securityGroups.some((item) => item.id === id && item.vpcId === vpc.id));
  }
  if (step === 2) {
    const mode = spec.storageMode || "dynamic_block";
    const cloud = mode === "dynamic_block" || mode === "existing_block" || mode === "shared_file";
    return !!spec.storageClass && storageSelectionsSchema.safeParse(spec.storageSelections || []).success &&
      (spec.volumeBindings || []).length === 0 &&
      (cloud ? Number.isInteger(spec.defaultPvcGb) && spec.defaultPvcGb > 0 && spec.defaultPvcGb <= 32768 && !spec.localPvGb :
        mode === "local_nvme" && spec.defaultPvcGb === 0 && Number.isInteger(spec.localPvGb) && !!spec.localPvGb &&
        spec.localPvGb <= Math.min(...spec.nodePools.map((pool) => lookups?.pools.find((item) => item.code === pool.poolCode)?.localNvmeGb || 0)));
  }
  if (step === 3)
    return z.array(nodePoolSchema).min(1).max(5).safeParse(spec.nodePools).success &&
      new Set(spec.nodePools.map(poolName)).size === spec.nodePools.length &&
      spec.nodePools.every((pool) => {
        const hardware = lookups?.pools.find((item) => item.code === pool.poolCode);
        const image = lookups?.images.find((item) => item.id === (pool.imageRef || "ubuntu-22.04"));
        return !!hardware && hardware.available && pool.gpuPerNode === hardware.gpusPerNode &&
          (pool.minNodes ?? 1) <= pool.nodeCount && pool.nodeCount <= (pool.maxNodes ?? 64) &&
          (spec.localPvGb || 0) <= hardware.localNvmeGb &&
          !!image && image.type === "os" && image.osFamily !== "Windows Server" &&
          imageSupportsPool(image, pool.poolCode) && imageSupportsArchitecture(image, hardware.cpuArchitecture);
      });
  if (step === 4)
    return (!spec.ingressEnabled || (spec.ingressClass === "nginx" && !!spec.vpc && selectedSubnets(spec).length > 0 && !!spec.securityGroups?.length)) &&
      (!spec.rbacDefaultAdmin || ["owner", "admin"].includes(useAuth.getState().role));
  return vgpuSchema.safeParse(spec).success;
}

function ManagedControlPlane({ spec }: { spec: VgpuSpec }) {
  const general = spec.nodePools.filter((pool) => pool.role === "general").length;
  const gpu = spec.nodePools.filter((pool) => pool.role !== "general").length;
  return <Panel title={t("eks.managedControlPlaneTitle")}>
    <p className="cluster-managed-intro">{t("eks.managedControlPlaneIntro")}</p>
    <div className="cluster-managed-architecture">
      <div className="cluster-managed-layer platform">
        <small>{t("eks.platformManaged")}</small>
        <strong>{t("eks.managedControlPlane")}</strong>
        <div className="cluster-managed-components"><span>API Server</span><span>etcd</span><span>Scheduler</span><span>Controller Manager</span></div>
        <small>{t("eks.managedTierSummary", { tier: spec.controlPlaneTier.toUpperCase(), version: spec.k8sVersion })}</small>
      </div>
      <span className="cluster-managed-link" aria-hidden="true">↕</span>
      <div className="cluster-managed-layer">
        <small>{t("eks.customerManaged")}</small>
        <strong>{t("eks.workerNodeGroups")}</strong>
        <div className="cluster-managed-components"><span>{t("eks.generalWorkers", { count: general })}</span><span>{t("eks.gpuWorkers", { count: gpu })}</span></div>
        <small>{t("eks.workerConfigLater")}</small>
      </div>
    </div>
  </Panel>;
}

function ClusterBasics() {
  const { spec } = useSpec<VgpuSpec>();
  return <div className="stack">
    <ManagedControlPlane spec={spec} />
    <p>{t("eks.projectStepIntro")}</p>
    <div className="form-grid">
      <SpecText name="description" label={t("common.description")} />
      <DeploymentOptionSelect name="k8sVersion" label={t("resource.k8s")} />
      <SpecSelect name="controlPlaneTier" label={t("eks.managedServiceTier")} options={["standard", "ha"]} />
    </div>
    <small>{t("eks.managedTierHint")}</small>
    <Panel title={t("eks.apiAccess")}>
      <SpecCheck name="apiServerPublic" label={t("wizard.apiPublic")} />
      {spec.apiServerPublic && <SpecText name="authorizedCidr" label={t("wizard.cidr")} />}
      {spec.apiServerPublic && !isCidr(spec.authorizedCidr) && <p className="field-error">{t("eks.authorizedCidrInvalid")}</p>}
      <small>{t("eks.apiAccessHint")}</small>
    </Panel>
  </div>;
}

function ClusterNetwork() {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const region = form.watch("region"), projectId = form.watch("projectId");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCidr, setNewCidr] = useState("10.100.0.0/16");
  const [newSubnets, setNewSubnets] = useState(() => plannedSubnets("10.100.0.0/16", region));
  const [planError, setPlanError] = useState("");
  const [suggestion, setSuggestion] = useState<{ podCidr: string; serviceCidr: string } | null>(null);
  const { run, busy } = useAction();
  const options = useData<DeploymentOptions>(["cluster-network-options", region, projectId],
    EP.options + query({ region, project_id: projectId, kind: "vgpu" }), { enabled: !!projectId, poll: true, pollMs: 5000 });
  const vpcs = (options.data?.vpcs || []).filter((vpc) => vpcNetworkType(vpc) === "standard");
  const selected = vpcs.find((vpc) => vpc.id === spec.vpc);
  const groups = (options.data?.securityGroups || []).filter((group) => group.vpcId === selected?.id);
  useEffect(() => {
    const availableVpcs = options.data?.vpcs.filter((item) => vpcNetworkType(item) === "standard") || [];
    if (!options.data || !availableVpcs.length) return;
    const current = form.getValues("spec") as VgpuSpec;
    const vpc = availableVpcs.find((item) => item.id === current.vpc) || availableVpcs[0];
    const validIds = current.subnets?.filter((id) => vpc.subnets.some((subnet) => subnet.id === id));
    const chosen = validIds ?? vpc.subnets.slice(0, Math.min(2, vpc.subnets.length)).map((subnet) => subnet.id);
    const primary = chosen[0] || "";
    const securityGroups = (current.securityGroups || []).filter((id) => options.data.securityGroups.some((item) => item.id === id && item.vpcId === vpc.id));
    const nextGroups = securityGroups.length ? securityGroups : options.data.securityGroups.filter((item) => item.vpcId === vpc.id).slice(0, 1).map((item) => item.id);
    if (current.vpc !== vpc.id || current.subnet !== primary || JSON.stringify(current.subnets) !== JSON.stringify(chosen) || JSON.stringify(current.securityGroups) !== JSON.stringify(nextGroups))
      form.setValue("spec", { ...current, vpc: vpc.id, subnet: primary, subnets: chosen, securityGroups: nextGroups }, { shouldDirty: true, shouldValidate: true });
  }, [options.data, form, region, projectId]);
  const ids = selectedSubnets(spec);
  const chosen = ids.map((id) => selected?.subnets.find((subnet) => subnet.id === id)).filter((item) => !!item);
  const neededIps = requiredIps(spec);
  const totalIps = chosen.reduce((sum, subnet) => sum + subnet.availableIps, 0);
  const ipsInvalid = chosen.length > 0 && chosen.some((subnet, index) => subnet.availableIps < subnetDemand(index, chosen.length, neededIps));
  const zonesInvalid = spec.controlPlaneTier === "ha" && new Set(chosen.map((item) => item.zone)).size < 2;
  const layoutInvalid = !!selected && !vpcSubnetsValid(selected);
  const cidrError = selected ? cidrProblem(spec.podCidr || "", spec.serviceCidr || "", vpcs.map((item) => item.cidr)) : "";
  const blockedCidrs = vpcs.map((vpc) => vpc.cidr);
  const nextVpcCidr = () => Array.from({ length: 100 }, (_, index) => `10.${100 + index}.0.0/16`).find((candidate) => blockedCidrs.every((cidr) => !cidrOverlaps(candidate, cidr))) || "10.100.0.0/16";
  const switchVpc = (vpc: DeploymentOptions["vpcs"][number], data = options.data) => {
    const subnets = vpc.subnets.slice(0, Math.min(2, vpc.subnets.length)).map((subnet) => subnet.id);
    const proposed = suggestedClusterCidrs((data?.vpcs || []).map((item) => item.cidr), spec.podCidr, spec.serviceCidr);
    update({ vpc: vpc.id, subnet: subnets[0] || "", subnets,
      securityGroups: data?.securityGroups.filter((group) => group.vpcId === vpc.id).slice(0, 1).map((group) => group.id) || [],
      volumeBindings: [], ...(proposed || { podCidr: "", serviceCidr: "" }) });
    setSuggestion(null);
  };
  const updateNewCidr = (cidr: string) => { setNewCidr(cidr); setNewSubnets(plannedSubnets(cidr, region)); setPlanError(""); };
  const createVpc = async () => {
    const cidr = cidrRange(newCidr);
    if (!newName.trim() || !cidr || !privateCidr(newCidr) || cidr.prefix < 8 || cidr.prefix > 28) { setPlanError(t("eks.invalidVpcPlan")); return; }
    if (blockedCidrs.some((existing) => cidrOverlaps(newCidr, existing))) { setPlanError(t("eks.newVpcOverlap")); return; }
    if (newSubnets.length < (spec.controlPlaneTier === "ha" ? 2 : 1) ||
      newSubnets.some((subnet) => !subnet.name.trim() || !cidrContains(newCidr, subnet.cidr) || (cidrRange(subnet.cidr)?.prefix || 32) > 29 || ![`${region}-a`, `${region}-b`].includes(subnet.zone)) ||
      newSubnets.some((subnet, index) => newSubnets.slice(index + 1).some((other) => cidrOverlaps(subnet.cidr, other.cidr))) ||
      (spec.controlPlaneTier === "ha" && new Set(newSubnets.map((subnet) => subnet.zone)).size < 2)) { setPlanError(t("eks.invalidSubnetPlan")); return; }
    const created = await run(() => post<DeploymentOptions["vpcs"][number]>(`${EP.network}/vpcs`, {
      projectId, region, name: newName.trim(), cidr: newCidr, networkType: "standard",
      subnets: newSubnets.map((subnet) => ({ ...subnet, name: subnet.name.trim() })),
    }));
    if (!created) return;
    const refreshed = await options.refetch();
    const vpc = refreshed.data?.vpcs.find((item) => item.id === created.id);
    if (vpc) switchVpc(vpc, refreshed.data);
    setCreateOpen(false);
  };
  if (options.isPending) return <Loading />;
  if (options.error) return <ErrorState error={options.error} />;
  return <div className="stack">
    <p>{t("eks.networkStepIntro")}</p>
    <Panel title={t("eks.endpointNetworkPolicy")}>
      <KeyValues items={[[t("eks.endpointAccess"), t(spec.apiServerPublic ? "eks.publicAndPrivateEndpoint" : "eks.privateEndpoint")],
        [t("eks.authorizedNetworks"), spec.apiServerPublic ? spec.authorizedCidr : t("eks.selectedVpcNetwork")],
        [t("eks.controlPlaneNetwork"), spec.controlPlaneTier === "ha" ? t("eks.haZoneRequirement") : t("eks.standardZoneRequirement")]]} />
      <small>{t("eks.endpointWorkerCommunication")}</small>
    </Panel>
    <Panel title={t("eks.vpcConfig")} action={<Button onClick={() => { setNewName(""); const cidr = nextVpcCidr(); setNewCidr(cidr); setNewSubnets(plannedSubnets(cidr, region)); setPlanError(""); setCreateOpen(true); }}>{t("network.createVpc")}</Button>}>
      <Field label={t("eks.existingVpc")}><select value={selected?.id || ""} onChange={(event) => {
        const next = vpcs.find((vpc) => vpc.id === event.target.value);
        if (next) switchVpc(next);
      }}><option value="">{t("network.select")}</option>{vpcs.map((vpc) => <option key={vpc.id} value={vpc.id}>{vpc.name} · {formatResourceId("vpc", vpc.id)} · {vpc.cidr}</option>)}</select></Field>
      {selected && <KeyValues items={[["VPC CIDR", selected.cidr], [t("eks.availableZones"), new Set(selected.subnets.map((subnet) => subnet.zone)).size], [t("eks.subnetCount"), selected.subnets.length]]} />}
      {layoutInvalid && <p className="field-error">{t("eks.vpcSubnetConflict")}</p>}
      {selected && !selected.subnets.length && <p className="field-error">{t("eks.noVpcSubnets")} <Link to={`/network/vpcs?region=${region}&project_id=${projectId}&drawer=${selected.id}`} target="_blank" rel="noreferrer">{t("eks.manageVpcSubnets")}</Link></p>}
    </Panel>
    <Panel title={t("eks.nodeSubnetTitle")} hint={t("eks.nodeSubnetHint")}>
      <KeyValues items={[[t("eks.controlPlaneIpCount"), spec.controlPlaneTier === "ha" ? 3 : 1],
        [t("eks.currentGpuNodes"), spec.nodePools.reduce((count, pool) => count + pool.nodeCount, 0)],
        [t("eks.peakIpDemand"), neededIps]]} />
      <div className="cluster-subnet-list">
        {(selected?.subnets || []).map((subnet) => {
          const index = ids.indexOf(subnet.id);
          const demand = index < 0 ? 0 : subnetDemand(index, ids.length, neededIps);
          const invalid = !cidrContains(selected!.cidr, subnet.cidr) || selected!.subnets.some((other) => other.id !== subnet.id && cidrOverlaps(other.cidr, subnet.cidr));
          return <label className="cluster-subnet-row" key={subnet.id}>
            <input type="checkbox" checked={index >= 0} onChange={(event) => {
              const next = event.target.checked ? [...ids, subnet.id] : ids.filter((id) => id !== subnet.id);
              update({ subnets: next, subnet: next[0] || "", volumeBindings: [] });
            }} />
            <span><strong>{subnet.name}</strong><small>{formatResourceId("sub", subnet.id)}</small></span>
            <span><strong>{subnet.zone}</strong><small>{subnet.cidr}</small></span>
            <span><strong>{t("eks.privateNodeSubnet")}</strong><small>{t("eks.fiveReservedIps", { total: subnetCapacity(subnet.cidr) })}</small></span>
            <span><strong>{t("network.availableIp", { count: subnet.availableIps })}</strong><small>{index >= 0 ? t("eks.requiredIpInSubnet", { count: demand }) : t("eks.notSelected")}</small></span>
            {invalid && <small className="field-error">{t("eks.vpcSubnetConflict")}</small>}
          </label>;
        })}
      </div>
      {selected && selected.subnets.length > 0 && !ids.length && <p className="field-error">{t("eks.chooseSubnet")}</p>}
      {zonesInvalid && <p className="field-error">{t("eks.haNeedsTwoZones")}</p>}
      {ipsInvalid && <p className="field-error">{t("eks.subnetIpsInsufficient", { needed: neededIps, available: totalIps })}</p>}
      <small>{t("eks.privateRouteHint")}</small>
    </Panel>
    <Panel title={t("eks.kubernetesNetworkTitle")}>
      <div className="form-grid">
        <Field label="CNI"><select value={spec.networkPlugin} onChange={(event) => update({ networkPlugin: event.target.value })}><option value="cilium">Cilium · Overlay</option><option value="calico">Calico · Overlay</option></select></Field>
        <Field label={t("field.securityGroups")}><select value={spec.securityGroups?.[0] || ""} onChange={(event) => update({ securityGroups: event.target.value ? [event.target.value] : [] })}><option value="">{t("network.select")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {formatResourceId("sgr", group.id)}</option>)}</select></Field>
        <Field label={t("eks.podCidr")}><input className="input" value={spec.podCidr || ""} onChange={(event) => update({ podCidr: event.target.value })} />{cidrError === "eks.invalidPodCidr" || cidrError === "eks.podVpcOverlap" || cidrError === "eks.podServiceOverlap" ? <small className="field-error">{t(cidrError)}</small> : null}</Field>
        <Field label={t("eks.serviceCidr")}><input className="input" value={spec.serviceCidr || ""} onChange={(event) => update({ serviceCidr: event.target.value })} />{cidrError === "eks.invalidServiceCidr" || cidrError === "eks.serviceVpcOverlap" || cidrError === "eks.podServiceOverlap" ? <small className="field-error">{t(cidrError)}</small> : null}</Field>
      </div>
      {!groups.length && selected && <p className="field-error">{t("eks.noSecurityGroup")} <Link to={`/network/security-groups?region=${region}&project_id=${projectId}`} target="_blank" rel="noreferrer">{t("eks.manageSecurityGroup")}</Link></p>}
      <small>{t("eks.cniOverlayHint")}</small>
      <small>{t("eks.securityGroupScope")}</small>
      <div className="row"><Button onClick={() => setSuggestion(suggestedClusterCidrs(blockedCidrs, spec.podCidr, spec.serviceCidr))} disabled={!selected}>{t("eks.autoCidrs")}</Button></div>
      {suggestion && <div className="notice"><strong>{t("eks.cidrProposal")}</strong><span>{t("eks.podCidr")}: {suggestion.podCidr} · {t("eks.serviceCidr")}: {suggestion.serviceCidr}</span><Button onClick={() => { update(suggestion); setSuggestion(null); }}>{t("eks.applyCidrs")}</Button></div>}
      {!suggestion && selected && !suggestedClusterCidrs(blockedCidrs, spec.podCidr, spec.serviceCidr) && <p className="field-error">{t("eks.noCidrCandidate")}</p>}
    </Panel>
    <Panel title={t("eks.networkTopology")}><div className="cluster-storage-flow"><span><strong>VPC · {selected?.name || "—"} ({selected?.cidr || "—"})</strong></span>
      {chosen.map((subnet, index) => <span key={subnet.id}><b aria-hidden="true">→</b><strong>{subnet.name} · {subnet.zone} · {subnetDemand(index, chosen.length, neededIps)} IP</strong></span>)}
      <span><b aria-hidden="true">→</b><strong>{t("eks.controlAndGpuNodes", { control: spec.controlPlaneTier === "ha" ? 3 : 1, nodes: spec.nodePools.reduce((count, pool) => count + pool.nodeCount, 0) })}</strong></span>
      <span><b aria-hidden="true">→</b><strong>{spec.networkPlugin} · Pod {spec.podCidr || "—"} / Service {spec.serviceCidr || "—"}</strong></span>
    </div><small>{t("eks.networkTopologyHint")}</small></Panel>
    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t("network.createVpc")} description={t("eks.createVpcModalHint")}>
      <div className="stack"><div className="form-grid"><Field label={t("common.name")}><input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} /></Field>
        <Field label="VPC CIDR"><input className="input" value={newCidr} onChange={(event) => updateNewCidr(event.target.value)} /></Field></div>
        {newSubnets.map((subnet, index) => <div className="form-grid" key={index}>
          <Field label={t("eks.subnetNameIndex", { index: index + 1 })}><input className="input" value={subnet.name} onChange={(event) => setNewSubnets(newSubnets.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
          <Field label="CIDR"><input className="input" value={subnet.cidr} onChange={(event) => setNewSubnets(newSubnets.map((item, i) => i === index ? { ...item, cidr: event.target.value } : item))} /></Field>
          <Field label={t("eks.availableZones")}><select value={subnet.zone} onChange={(event) => setNewSubnets(newSubnets.map((item, i) => i === index ? { ...item, zone: event.target.value } : item))}><option value={`${region}-a`}>{region}-a</option><option value={`${region}-b`}>{region}-b</option></select></Field>
        </div>)}
        {planError && <p className="field-error">{planError}</p>}
        <small>{t("eks.vpcPlanSecurityGroup")}</small>
        <div className="row"><Button variant="primary" disabled={busy || !projectId} onClick={() => void createVpc()}>{t("network.createVpc")}</Button><Button onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button></div>
      </div>
    </Modal>
  </div>;
}

type ClusterStorageMode = NonNullable<VgpuSpec["storageMode"]>;
const storageModes: ClusterStorageMode[] = ["dynamic_block", "existing_block", "local_nvme", "shared_file"];

function ClusterStorage({ pools }: { pools: Pool[] }) {
  const { spec, update } = useSpec<VgpuSpec>();
  const mode: ClusterStorageMode = spec.storageMode || "dynamic_block";
  const nodes = spec.nodePools.reduce((total, pool) => total + pool.nodeCount, 0);
  const maxLocal = Math.min(...spec.nodePools.map((pool) => pools.find((item) => item.code === pool.poolCode)?.localNvmeGb || 0));
  const physicalLocal = spec.nodePools.reduce((total, pool) => total + pool.nodeCount * (pools.find((item) => item.code === pool.poolCode)?.localNvmeGb || 0), 0);
  const isBlock = mode === "dynamic_block" || mode === "existing_block";
  const cloud = isBlock || mode === "shared_file";
  const totalCapacity = isBlock ? spec.defaultPvcGb * nodes : mode === "shared_file" ? spec.defaultPvcGb : (spec.localPvGb || 0) * nodes;
  const volumeCount = mode === "shared_file" ? 1 : nodes;
  const chooseMode = (next: ClusterStorageMode) => update({ storageMode: next,
    defaultPvcGb: next === "local_nvme" ? 0 : 100,
    localPvGb: next === "local_nvme" ? Math.min(100, maxLocal) : 0,
    volumeBindings: [], storageClass: next === "shared_file" ? "shared-fs" : "ssd" });
  const relationship = mode === "local_nvme" ? ["Pod", "PVC", "Local PV", "NVMe", t("eks.gpuNode")] :
    ["Pod", "PVC", "PV", mode === "shared_file" ? t("eks.platformFileVolume") : t("eks.platformBlockVolume")];
  return <div className="stack cluster-storage-step">
    <p>{t("eks.storageStepIntro")}</p>
    <Panel title={t("eks.clusterStoragePolicy")}>
      <KeyValues items={[[t("eks.csiState"), t("eks.managedCsi")], [t("eks.defaultStorageClass"), mode === "shared_file" ? "shared-fs" : mode === "local_nvme" ? "local-nvme" : spec.storageClass]]} />
      <small>{t("eks.clusterStoragePolicyHint")}</small>
    </Panel>
    <Panel title={t("eks.chooseStorageScheme")}>
      <div className="cluster-storage-options">{storageModes.map((item) => <button type="button" key={item}
        className={`cluster-storage-option ${mode === item ? "selected" : ""}`}
        aria-pressed={mode === item} onClick={() => chooseMode(item)}>
        <strong>{t(`eks.storageMode.${item}`)}</strong><small>{t(`eks.storageModeHint.${item}`)}</small>
      </button>)}</div>
    </Panel>
    {cloud && <Panel title={t("eks.requestedCapacity")}>
      <div className="form-grid">
        <SpecNumber name="defaultPvcGb" label={isBlock ? t("eks.capacityPerNode") : t("eks.sharedCapacity")} min={1} max={32768} />
        <Field label={t("eks.accessMode")}><strong>{t(mode === "shared_file" ? "eks.rwx" : "eks.rwo")}</strong></Field>
      </div>
      <KeyValues items={[[t("eks.nodeCount"), nodes], [t("eks.generatedVolumeCount"), volumeCount], [t("eks.totalProvisionedCapacity"), `${totalCapacity} GB`]]} />
      <small>{t(isBlock ? "eks.perNodeProvisionHint" : "eks.sharedProvisionHint")}</small>
    </Panel>}
    {mode === "local_nvme" && <Panel title={t("eks.localPv")}>
      <div className="form-grid"><Field label={t("eks.localPvPerNode")} hint={`1–${maxLocal} GB`}><input className="input" type="number" min={1} max={maxLocal} value={spec.localPvGb || 0} onChange={(event) => update({ localPvGb: Number(event.target.value) })} /></Field>
        <Field label={t("eks.nodeCount")}><strong>{nodes}</strong></Field></div>
      <KeyValues items={[[t("eks.physicalLocalCapacity"), `${physicalLocal} GB`], [t("eks.schedulableLocalCapacity"), `${totalCapacity} GB`], [t("eks.generatedVolumeCount"), nodes]]} />
      <small className="field-error">{t("eks.localPvHint")}</small>
      {(!spec.localPvGb || spec.localPvGb > maxLocal) && <p className="field-error">{t("error.INVALID_LOCAL_PV_SIZE")}</p>}
    </Panel>}
    <Panel title={t("eks.storageRelationship")}><div className="cluster-storage-flow">
      {relationship.map((item, index) => <span key={`${item}-${index}`}>{index > 0 && <b aria-hidden="true">→</b>}<strong>{item}</strong></span>)}
    </div><small>{t(`eks.storageRelationshipHint.${mode}`)}</small></Panel>
    <Panel title={t("eks.storageSummary")}><KeyValues items={[
      [t("eks.storageScheme"), t(`eks.storageMode.${mode}`)],
      [t("eks.nodeCount"), nodes], [t("eks.generatedVolumeCount"), volumeCount],
      [t("eks.totalProvisionedCapacity"), `${totalCapacity} GB`],
    ]} /><small>{t("eks.nodeCountRecalculatesStorage")}</small></Panel>
  </div>;
}

function ClusterNodes({ pools, images }: FormContext) {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const updatePool = (index: number, patch: Partial<VgpuSpec["nodePools"][number]>) => {
    const nodePools = spec.nodePools.map((pool, i) => i === index ? { ...pool, ...patch } : pool);
    update({ nodePools, gpuCount: nodePools.reduce((sum, pool) => sum + pool.nodeCount * pool.gpuPerNode, 0) });
  };
  return <div className="stack"><p>{t("eks.nodeStepIntro")}</p><div className="notice">{t("eks.workerOnlyNotice")}</div>
    {spec.nodePools.map((pool, index) => {
      const hardware = pools.find((item) => item.code === pool.poolCode);
      return <Panel key={index} title={`${t("cluster.nodePool")} ${index + 1} · ${poolName(pool, index)}`} action={spec.nodePools.length > 1 ? <Button onClick={() => update({ nodePools: spec.nodePools.filter((_, i) => i !== index) })}>{t("wizard.removePool")}</Button> : undefined}>
        <div className="stack">
          <div className="form-grid">
            <Field label={t("common.name")}><input className="input" value={poolName(pool, index)} onChange={(event) => updatePool(index, { name: event.target.value })} /></Field>
            <Field label={t("eks.nodeRole")}><select value={pool.role || "gpu"} onChange={(event) => updatePool(index, { role: event.target.value as "gpu" | "general", gpuTaint: event.target.value === "gpu", labels: { ...pool.labels, "workload.runsuncloud.com/type": event.target.value } })}><option value="gpu">{t("eks.gpuWorkload")}</option><option value="general">{t("eks.generalWorkload")}</option></select></Field>
          </div>
          <PoolCards kind="vgpu" pools={pools} selected={pool.poolCode} onSelect={(next) => {
            if (index === 0) form.setValue("nodePool", next.code);
            const image = images.find((item) => item.id === pool.imageRef && item.type === "os" && imageSupportsPool(item, next.code) && imageSupportsArchitecture(item, next.cpuArchitecture));
            updatePool(index, { poolCode: next.code, gpuPerNode: next.gpusPerNode, migProfile: next.migProfile, imageRef: image?.id || "ubuntu-22.04" });
          }} />
          {(pool.minNodes ?? 1) > pool.nodeCount || pool.nodeCount > (pool.maxNodes ?? 64) ? <p className="field-error">{t("error.INVALID_NODE_POOL_RANGE")}</p> : null}
          {(spec.localPvGb || 0) > (hardware?.localNvmeGb || 0) ? <p className="field-error">{t("error.INVALID_LOCAL_PV_SIZE")}</p> : null}
          <KeyValues items={[[t("eks.gpuModel"), hardware?.gpuModel || pool.poolCode], [t("eks.perNodeCapacity"), `${hardware?.gpusPerNode || pool.gpuPerNode} GPU · ${(hardware?.gpusPerNode || pool.gpuPerNode) * 16} vCPU · ${hardware?.memorySystemGb || 0} GB RAM`], [t("eks.localNvme"), `${hardware?.localNvmeGb || 0} GB`]]} />
          <div className="form-grid">
            <Field label={t("resource.nodeCount")}><input className="input" type="number" min={1} max={64} value={pool.nodeCount} onChange={(event) => updatePool(index, { nodeCount: Number(event.target.value) })} /></Field>
            <Field label={t("eks.minNodes")}><input className="input" type="number" min={1} max={64} value={pool.minNodes ?? 1} onChange={(event) => updatePool(index, { minNodes: Number(event.target.value) })} /></Field>
            <Field label={t("eks.maxNodes")}><input className="input" type="number" min={1} max={64} value={pool.maxNodes ?? 64} onChange={(event) => updatePool(index, { maxNodes: Number(event.target.value) })} /></Field>
            <Field label={t("eks.nodeDisk")}><input className="input" type="number" min={100} max={4096} value={pool.diskGb ?? 200} onChange={(event) => updatePool(index, { diskGb: Number(event.target.value) })} /></Field>
            <Field label={t("eks.nodeImage")}><select value={pool.imageRef || "ubuntu-22.04"} onChange={(event) => updatePool(index, { imageRef: event.target.value })}>{images.filter((image) => image.type === "os" && image.osFamily !== "Windows Server" && imageSupportsPool(image, pool.poolCode) && imageSupportsArchitecture(image, hardware?.cpuArchitecture || "x86_64")).map((image) => <option key={image.id} value={image.id}>{image.name}</option>)}</select></Field>
            <Field label={t("resource.slicing")}><select value={pool.slicingPolicy} onChange={(event) => updatePool(index, { slicingPolicy: event.target.value })}>{["none", "mig", "time_slicing", "mps"].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field>
            {pool.slicingPolicy === "mig" && <Field label="MIG Profile"><select value={pool.migProfile} onChange={(event) => updatePool(index, { migProfile: event.target.value })}>{(hardware?.migProfiles || [hardware?.migProfile || pool.migProfile]).map((value) => <option key={value}>{value}</option>)}</select></Field>}
            {pool.slicingPolicy === "time_slicing" && <Field label="Time slice"><input className="input" type="number" min={2} max={8} value={pool.timeSliceShare} onChange={(event) => updatePool(index, { timeSliceShare: Number(event.target.value) })} /></Field>}
            <Field label={t("eks.nodeLabel")}><input className="input" value={pool.labels?.["workload.runsuncloud.com/type"] || "gpu"} onChange={(event) => updatePool(index, { labels: { ...pool.labels, "workload.runsuncloud.com/type": event.target.value } })} /></Field>
            <Field label={t("eks.gpuTaint")}><select value={pool.gpuTaint === false ? "off" : "on"} onChange={(event) => updatePool(index, { gpuTaint: event.target.value === "on" })}><option value="on">{t("common.enabled")}</option><option value="off">{t("common.disabled")}</option></select></Field>
          </div>
          <small>{t("eks.nodePoolCapacity", { nodes: pool.nodeCount, gpus: pool.nodeCount * pool.gpuPerNode })}</small>
        </div>
      </Panel>;
    })}
    <Button disabled={spec.nodePools.length >= 5} onClick={() => {
      const first = spec.nodePools[0]; update({ nodePools: [...spec.nodePools, { ...first, name: `gpu-pool-${spec.nodePools.length + 1}`, nodeCount: 1, labels: { ...first.labels } }] });
    }}>{t("wizard.addPool")}</Button>
    <ScalingToggle kind="vgpu" />
  </div>;
}

function ClusterAddons() {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const role = useAuth((state) => state.role);
  const region = form.watch("region"), projectId = form.watch("projectId");
  const network = useData<DeploymentOptions>(["cluster-network-options", region, projectId],
    EP.options + query({ region, project_id: projectId, kind: "vgpu" }), { enabled: !!projectId });
  const vpc = network.data?.vpcs.find((item) => item.id === spec.vpc);
  const subnetNames = vpc?.subnets.filter((item) => selectedSubnets(spec).includes(item.id)).map((item) => `${item.name} · ${item.zone}`) || [];
  const gpuPools = spec.nodePools.filter((pool) => pool.role !== "general");
  const canGrantAdmin = role === "owner" || role === "admin";
  const setEntry = (ingress: boolean) => update({ ingressEnabled: ingress, ingressClass: ingress ? "nginx" : "" });
  return <div className="stack">
    <p>{t("eks.addonsStepIntro")}</p>
    <Panel title={t("eks.gpuRuntimeTitle")} hint={t("eks.gpuRuntimeHint")}>
      <KeyValues items={[
        [t("eks.gpuTargets"), gpuPools.map((pool) => poolName(pool, spec.nodePools.indexOf(pool))).join(" / ") || t("eks.noGpuPool")],
        ["GPU Operator", t("eks.operatorRole")],
        ["Device Plugin", t("eks.devicePluginRole")],
        ["NFD", t("eks.nfdRole")],
        [t("eks.deploymentPolicy"), t("eks.platformManagedWithNodes")],
      ]} />
      <small>{t("eks.gpuRuntimeDependency")}</small>
    </Panel>
    <Panel title={t("eks.clusterEntryTitle")} hint={t("eks.clusterEntryHint")}>
      <div className="cluster-storage-options">
        {[false, true].map((ingress) => <button type="button" key={String(ingress)}
          className={`cluster-storage-option ${spec.ingressEnabled === ingress ? "selected" : ""}`}
          aria-pressed={spec.ingressEnabled === ingress} onClick={() => setEntry(ingress)}>
          <strong>{t(ingress ? "eks.entryIngress" : "eks.entryInternal")}</strong>
          <small>{t(ingress ? "eks.entryIngressHint" : "eks.entryInternalHint")}</small>
        </button>)}
      </div>
      <KeyValues items={[["VPC", vpc ? `${vpc.name} · ${formatResourceId("vpc", vpc.id)}` : spec.vpc ? formatResourceId("vpc", spec.vpc) : "—"],
        [t("eks.subnetConfig"), subnetNames.join(" / ") || "—"],
        [t("field.securityGroups"), spec.securityGroups?.map((id) => formatResourceId("sgr", id)).join(" / ") || "—"]]} />
      {spec.ingressEnabled ? <div className="stack">
        <KeyValues items={[[t("eks.ingressController"), "NGINX · " + t("eks.platformManagedMock")],
          [t("eks.ingressResource"), t("eks.ingressCreatedAfterCluster")]]} />
        <small>{t("eks.ingressNetworkHint")}</small>
        {(!vpc || !selectedSubnets(spec).length || !spec.securityGroups?.length) && <p className="field-error">{t("eks.ingressNeedsNetwork")}</p>}
      </div> : <small>{t("eks.internalAccessHint")}</small>}
    </Panel>
    <Panel title={t("eks.clusterPermissionsTitle")} hint={t("eks.clusterPermissionsHint")}>
      <Check label={t("eks.grantProjectAdmin")} checked={spec.rbacDefaultAdmin}
        disabled={!canGrantAdmin && !spec.rbacDefaultAdmin} onChange={(checked) => update({ rbacDefaultAdmin: checked && canGrantAdmin })} />
      <small>{t(canGrantAdmin ? "eks.adminGrantScope" : "eks.adminGrantUnavailable")}</small>
      <KeyValues items={[[t("eks.initialAuthorization"), t(spec.rbacDefaultAdmin ? "eks.projectAdminGranted" : "eks.projectReadOnly")],
        [t("eks.kubeconfigAccess"), t("eks.kubeconfigAfterCreate")]]} />
    </Panel>
  </div>;
}

function ClusterConfirm({ context }: { context: FormContext }) {
  const { spec, form } = useSpec<VgpuSpec>();
  const values = form.watch();
  const vpc = useData<DeploymentOptions>(["cluster-network-options", values.region, values.projectId], EP.options + query({ region: values.region, project_id: values.projectId, kind: "vgpu" }));
  const selected = vpc.data?.vpcs.find((item) => item.id === spec.vpc);
  return <div className="stack"><p>{t("eks.confirmStepIntro")}</p>
    <ManagedControlPlane spec={spec} />
    <Panel title={t("eks.resourceSummary")}><KeyValues items={[
      [t("common.project"), context.projects.find((project) => project.id === values.projectId)?.name || values.projectId],
      [t("common.region"), t(`common.${values.region}`)], [t("common.name"), values.name],
      [t("resource.k8s"), spec.k8sVersion], [t("eks.managementMode"), t("eks.platformManaged")],
      [t("eks.managedServiceTier"), spec.controlPlaneTier.toUpperCase()],
      [t("eks.endpointAccess"), t(spec.apiServerPublic ? "eks.publicAndPrivateEndpoint" : "eks.privateEndpoint")],
      [t("eks.authorizedNetworks"), spec.apiServerPublic ? spec.authorizedCidr : t("eks.selectedVpcNetwork")],
      ["VPC", `${selected?.name || (spec.vpc ? formatResourceId("vpc", spec.vpc) : "—")} · ${selected?.cidr || ""}`],
      [t("eks.subnetConfig"), selected?.subnets.filter((item) => selectedSubnets(spec).includes(item.id)).map((item) => `${item.name} (${item.zone}, ${item.cidr})`).join(" / ") || spec.subnets?.join(" / ") || "—"],
      ["CNI", spec.networkPlugin], ["Pod / Service CIDR", `${spec.podCidr} / ${spec.serviceCidr}`],
      [t("eks.storageScheme"), t(`eks.storageMode.${spec.storageMode || "dynamic_block"}`)],
      [t("eks.generatedVolumeCount"), spec.storageMode === "shared_file" ? 1 : spec.nodePools.reduce((n, pool) => n + pool.nodeCount, 0)],
      [t("eks.totalProvisionedCapacity"), `${spec.storageMode === "local_nvme" ? (spec.localPvGb || 0) * spec.nodePools.reduce((n, pool) => n + pool.nodeCount, 0) : spec.storageMode === "shared_file" ? spec.defaultPvcGb : spec.defaultPvcGb * spec.nodePools.reduce((n, pool) => n + pool.nodeCount, 0)} GB`],
      [t("cluster.nodePool"), spec.nodePools.map((pool, index) => `${poolName(pool, index)} · ${pool.poolCode} · ${pool.nodeCount} × ${pool.gpuPerNode} GPU`).join(" / ")],
      [t("resource.gpu"), spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount * pool.gpuPerNode, 0)],
      [t("eks.clusterEntryTitle"), t(spec.ingressEnabled ? "eks.entryIngress" : "eks.entryInternal")],
      [t("eks.initialAuthorization"), t(spec.rbacDefaultAdmin ? "eks.projectAdminGranted" : "eks.projectReadOnly")],
    ]} /></Panel>
    <Review hideSpec />
  </div>;
}

function ClusterAside() {
  const { spec, form } = useSpec<VgpuSpec>();
  const region = form.watch("region"), projectId = form.watch("projectId");
  const network = useData<DeploymentOptions>(["cluster-network-options", region, projectId], EP.options + query({ region, project_id: projectId, kind: "vgpu" }), { enabled: !!projectId });
  const vpc = network.data?.vpcs.find((item) => item.id === spec.vpc);
  const subnetNames = vpc?.subnets.filter((item) => selectedSubnets(spec).includes(item.id)).map((item) => `${item.zone} · ${item.cidr}`) || [];
  const gpuCount = spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount * pool.gpuPerNode, 0);
  return <Panel title={t("eks.resourceChain")}><div className="cluster-resource-chain">
    <div><strong>VPC</strong><small>{vpc ? `${vpc.name} · ${vpc.cidr}` : t("network.select")}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>{t("eks.subnetConfig")}</strong><small>{subnetNames.length ? subnetNames.join(" / ") : t("network.select")}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>{t("eks.managedControlPlane")} · Kubernetes {spec.k8sVersion}</strong><small>{t("eks.platformManaged")} · {spec.controlPlaneTier.toUpperCase()}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>{t("eks.workerNodeGroups")} / Pod</strong><small>{t("eks.poolCount", { pools: spec.nodePools.length, nodes: spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount, 0), gpus: gpuCount })}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>{t("eks.storageRelationship")}</strong><small>{t(`eks.storageMode.${spec.storageMode || "dynamic_block"}`)} · {spec.storageMode === "local_nvme" ? spec.localPvGb : spec.defaultPvcGb} GB · {spec.storageMode === "shared_file" ? 1 : spec.nodePools.reduce((n, pool) => n + pool.nodeCount, 0)} PV</small></div>
  </div></Panel>;
}

export default function VgpuWizard() {
  return <WizardLayout kind="vgpu" clusterLayout aside={<ClusterAside />} firstStepContent={<ClusterBasics />}
    steps={["clusterProject", "clusterNetwork", "clusterStorage", "clusterNodes", "clusterAddons", "clusterConfirm"]}
    stepHints={["", "", "", "", "", ""].map((_, index) => t(`eks.stepHint${index + 1}`))}
    validateStep={validStep}
    validateFirstStep={(values) => validStep(values, 0)}
    render={(context) => context.step === 1 ? <ClusterNetwork /> : context.step === 2 ? <ClusterStorage pools={context.pools} /> : context.step === 3 ? <ClusterNodes {...context} /> : context.step === 4 ? <ClusterAddons /> : <ClusterConfirm context={context} />} />;
}
