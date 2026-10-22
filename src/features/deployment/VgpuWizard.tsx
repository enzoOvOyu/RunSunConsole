import { useEffect } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import type { DeploymentOptions, Pool, Image, VgpuSpec } from "../../types/domain";
import type { StorageVolume } from "../../types/storage";
import { cidrOverlaps, cidrRange, vpcNetworkType } from "../../lib/network";
import { EP, query } from "../../lib/api-client";
import { storageSelectionsSchema, nodePoolSchema, vgpuSchema, isCidr } from "../../lib/schema";
import { imageSupportsArchitecture, imageSupportsPool } from "./shared/image-compat";
import { t } from "../../i18n";
import { Button, Field, Loading, Panel, KeyValues, ErrorState } from "../../components/ui";
import { useData } from "../shared/hooks";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec, SpecCheck, SpecNumber, SpecSelect, SpecText,
  DeploymentOptionSelect, Review, ScalingToggle,
  type FormContext, type WizardValues,
} from "./shared/fields";

const poolName = (pool: VgpuSpec["nodePools"][number], index: number) => pool.name || `gpu-pool-${index + 1}`;
const selectedSubnets = (spec: VgpuSpec) => spec.subnets?.length ? spec.subnets : (spec.subnet ? [spec.subnet] : []);
const zoneForVolume = (volume: StorageVolume) => volume.zone || `${volume.region}-a`;
const suggestedCidrs = (vpcCidr: string) => {
  const candidates = ["172.20.0.0/16", "172.21.0.0/16", "172.22.0.0/16", "172.23.0.0/16", "10.240.0.0/16", "10.241.0.0/16", "10.242.0.0/16", "192.168.240.0/20", "192.168.224.0/20"];
  const available = candidates.filter((cidr) => !cidrOverlaps(cidr, vpcCidr));
  return { podCidr: available[0] || "172.20.0.0/16", serviceCidr: available[1] || "172.21.0.0/16" };
};
const cidrProblem = (podCidr: string, serviceCidr: string, vpcCidr: string) => {
  if (!cidrRange(podCidr)) return "eks.invalidPodCidr";
  if (!cidrRange(serviceCidr)) return "eks.invalidServiceCidr";
  if (cidrOverlaps(podCidr, serviceCidr)) return "eks.podServiceOverlap";
  if (cidrOverlaps(podCidr, vpcCidr)) return "eks.podVpcOverlap";
  if (cidrOverlaps(serviceCidr, vpcCidr)) return "eks.serviceVpcOverlap";
  return "";
};

function validStep(values: WizardValues, step: number, lookups?: { network?: DeploymentOptions; volumes?: StorageVolume[]; pools: Pool[]; images: Image[] }) {
  const spec = values.spec as VgpuSpec;
  if (step === 0) return ["1.28", "1.29", "1.30", "1.31"].includes(spec.k8sVersion) &&
    ["standard", "ha"].includes(spec.controlPlaneTier) && (!spec.apiServerPublic || isCidr(spec.authorizedCidr));
  if (step === 1) {
    if (spec.apiServerPublic && !isCidr(spec.authorizedCidr)) return false;
    const subnets = selectedSubnets(spec);
    const vpc = lookups?.network?.vpcs.find((item) => item.id === spec.vpc && vpcNetworkType(item) === "standard");
    const chosen = vpc?.subnets.filter((item) => subnets.includes(item.id)) || [];
    const count = spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount, 0) + (spec.controlPlaneTier === "ha" ? 3 : 1);
    return !!vpc && subnets.length >= (spec.controlPlaneTier === "ha" ? 2 : 1) &&
      chosen.length === subnets.length && new Set(subnets).size === subnets.length && subnets.includes(spec.subnet) &&
      (spec.controlPlaneTier !== "ha" || new Set(chosen.map((item) => item.zone)).size >= 2) &&
      chosen.every((item, index) => item.availableIps >= Math.floor(count / chosen.length) + (index < count % chosen.length ? 1 : 0)) &&
      !!cidrRange(spec.podCidr || "") && !!cidrRange(spec.serviceCidr || "") &&
      !cidrOverlaps(spec.podCidr || "", spec.serviceCidr || "") &&
      !cidrOverlaps(spec.podCidr || "", vpc.cidr) && !cidrOverlaps(spec.serviceCidr || "", vpc.cidr) &&
      !!spec.securityGroups?.length && spec.securityGroups.every((id) => lookups?.network?.securityGroups.some((item) => item.id === id && item.vpcId === vpc.id)) && !!spec.networkPlugin;
  }
  if (step === 2)
    return !!spec.storageClass && Number.isInteger(spec.defaultPvcGb) && spec.defaultPvcGb >= 0 &&
      Number.isInteger(spec.localPvGb ?? 0) && (spec.localPvGb ?? 0) >= 0 &&
      storageSelectionsSchema.safeParse(spec.storageSelections || []).success &&
      vgpuSchema.shape.volumeBindings.safeParse(spec.volumeBindings || []).success &&
      new Set((spec.volumeBindings || []).map((binding) => binding.volumeId)).size === (spec.volumeBindings || []).length &&
      new Set((spec.volumeBindings || []).map((binding) => `${binding.namespace}/${binding.pvcName}`)).size === (spec.volumeBindings || []).length &&
      (spec.volumeBindings || []).every((binding) => {
        const volume = lookups?.volumes?.find((item) => item.id === binding.volumeId);
        const vpc = lookups?.network?.vpcs.find((item) => item.id === spec.vpc);
        const zones = new Set(vpc?.subnets.filter((item) => selectedSubnets(spec).includes(item.id)).map((item) => item.zone));
        return !!volume && volume.kind === "block" && volume.role === "custom" && !volume.resourceUuid &&
          volume.projectId === values.projectId && volume.region === values.region && zones.has(zoneForVolume(volume));
      });
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
    return (!spec.ingressEnabled || !!spec.ingressClass) && !!spec.kubeconfigAccess;
  return vgpuSchema.safeParse(spec).success;
}

function ClusterBasics() {
  const { spec } = useSpec<VgpuSpec>();
  return <div className="stack">
    <p>{t("eks.projectStepIntro")}</p>
    <div className="form-grid">
      <SpecText name="description" label={t("common.description")} />
      <DeploymentOptionSelect name="k8sVersion" label={t("resource.k8s")} />
      <SpecSelect name="controlPlaneTier" label={t("wizard.controlPlane")} options={["standard", "ha"]} />
    </div>
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
  const zones = new Set(selected?.subnets.filter((subnet) => ids.includes(subnet.id)).map((subnet) => subnet.zone));
  const cidrError = selected ? cidrProblem(spec.podCidr || "", spec.serviceCidr || "", selected.cidr) : "";
  const nodeCount = spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount, 0);
  const neededIps = nodeCount + (spec.controlPlaneTier === "ha" ? 3 : 1);
  const chosen = selected?.subnets.filter((subnet) => ids.includes(subnet.id)) || [];
  const totalIps = chosen.reduce((sum, subnet) => sum + subnet.availableIps, 0);
  const ipsInvalid = chosen.length > 0 && chosen.some((subnet, index) =>
    subnet.availableIps < Math.floor(neededIps / chosen.length) + (index < neededIps % chosen.length ? 1 : 0));
  const zonesInvalid = spec.controlPlaneTier === "ha" && zones.size < 2;
  if (options.isPending) return <Loading />;
  if (options.error) return <ErrorState error={options.error} />;
  return <div className="stack">
    <p>{t("eks.networkStepIntro")}</p>
    <Panel title={t("eks.vpcConfig")}>
      <div className="cluster-network-choice">
        <div className="selected"><strong>{t("eks.existingVpc")}</strong><Field label="VPC"><select value={selected?.id || ""} onChange={(event) => {
          const next = vpcs.find((vpc) => vpc.id === event.target.value);
          if (!next) return;
          const subnets = next.subnets.slice(0, Math.min(2, next.subnets.length)).map((subnet) => subnet.id);
          update({ vpc: next.id, subnet: subnets[0] || "", subnets,
            securityGroups: options.data?.securityGroups.filter((group) => group.vpcId === next.id).slice(0, 1).map((group) => group.id) || [],
            volumeBindings: [], ...suggestedCidrs(next.cidr) });
        }}><option value="">{t("network.select")}</option>{vpcs.map((vpc) => <option key={vpc.id} value={vpc.id}>{vpc.name} · {vpc.cidr}</option>)}</select></Field></div>
        <Link to={`/network/vpcs?region=${region}&project_id=${projectId}`} target="_blank" rel="noreferrer"><strong>{t("network.createVpc")}</strong><small>{t("eks.createVpcHint")}</small></Link>
      </div>
      {selected && <KeyValues items={[["VPC CIDR", selected.cidr], [t("eks.availableZones"), new Set(selected.subnets.map((subnet) => subnet.zone)).size], [t("eks.subnetCount"), selected.subnets.length]]} />}
      {selected && !selected.subnets.length && <p className="field-error">{t("eks.noVpcSubnets")} <Link to={`/network/vpcs?region=${region}&project_id=${projectId}&drawer=${selected.id}`} target="_blank" rel="noreferrer">{t("eks.manageVpcSubnets")}</Link></p>}
    </Panel>
    <Panel title={t("eks.subnetConfig")}>
      <small>{t("eks.subnetHint")}</small>
      <div className="cluster-subnet-list">
        {(selected?.subnets || []).map((subnet) => <label className="cluster-subnet-row" key={subnet.id}>
          <input type="checkbox" checked={ids.includes(subnet.id)} onChange={(event) => {
            const next = event.target.checked ? [...ids, subnet.id] : ids.filter((id) => id !== subnet.id);
            update({ subnets: next, subnet: next[0] || "", volumeBindings: [] });
          }} />
          <span><strong>{subnet.name}</strong><small>{subnet.id}</small></span><span>{subnet.zone}<small>{subnet.cidr}</small></span><span>{t("network.availableIp", { count: subnet.availableIps })}</span>
        </label>)}
      </div>
      {selected && selected.subnets.length > 0 && !ids.length && <p className="field-error">{t("eks.chooseSubnet")}</p>}
      {zonesInvalid && <p className="field-error">{t("eks.haNeedsTwoZones")}</p>}
      {ipsInvalid && <p className="field-error">{t("eks.subnetIpsInsufficient", { needed: neededIps, available: totalIps })}</p>}
    </Panel>
    <Panel title={t("eks.podNetwork")} action={selected ? <Button onClick={() => update(suggestedCidrs(selected.cidr))}>{t("eks.autoCidrs")}</Button> : undefined}>
      <small>{t("eks.cidrExplainer")}</small>
      <div className="form-grid"><SpecText name="podCidr" label={t("eks.podCidr")} /><SpecText name="serviceCidr" label={t("eks.serviceCidr")} />
        <SpecSelect name="networkPlugin" label="CNI" options={["cilium", "calico"]} />
        <Field label={t("field.securityGroups")}><select value={spec.securityGroups?.[0] || ""} onChange={(event) => update({ securityGroups: event.target.value ? [event.target.value] : [] })}><option value="">{t("network.select")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
      </div>
      {!groups.length && selected && <p className="field-error">{t("eks.noSecurityGroup")} <Link to={`/network/security-groups?region=${region}&project_id=${projectId}`} target="_blank" rel="noreferrer">{t("eks.manageSecurityGroup")}</Link></p>}
      <small>{t("eks.cniHint")}</small>
      {cidrError && <p className="field-error">{t(cidrError)} {t("eks.cidrSuggestion", suggestedCidrs(selected?.cidr || ""))}</p>}
    </Panel>
  </div>;
}

function ClusterStorage({ pools }: { pools: Pool[] }) {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const region = form.watch("region"), projectId = form.watch("projectId");
  const volumeQuery = useData<StorageVolume[]>(["cluster-block-volumes", region, projectId],
    EP.storageVolumes + query({ region, project_id: projectId }), { poll: true, pollMs: 5000 });
  const network = useData<DeploymentOptions>(["cluster-network-options", region, projectId],
    EP.options + query({ region, project_id: projectId, kind: "vgpu" }), { enabled: !!projectId });
  const selectedZones = new Set(network.data?.vpcs.flatMap((vpc) => vpc.subnets).filter((subnet) => selectedSubnets(spec).includes(subnet.id)).map((subnet) => subnet.zone));
  const volumes = (volumeQuery.data || []).filter((volume) => volume.kind === "block" && volume.role === "custom" && !volume.resourceUuid && selectedZones.has(zoneForVolume(volume)));
  const bindings = spec.volumeBindings || [];
  const available = volumes.filter((volume) => !bindings.some((binding) => binding.volumeId === volume.id));
  const maxLocal = Math.min(...spec.nodePools.map((pool) => pools.find((item) => item.code === pool.poolCode)?.localNvmeGb || 0));
  return <div className="stack">
    <p>{t("eks.storageStepIntro")}</p>
    <Panel title={t("eks.dynamicPvc")}>
      <div className="form-grid"><SpecSelect name="storageClass" label="StorageClass / CSI" options={["ssd", "nvme", "shared-fs"]} /><SpecNumber name="defaultPvcGb" label="PVC · GB" min={0} max={32768} /></div>
      <small>{t("eks.dynamicPvcHint")}</small>
    </Panel>
    <Panel title={t("eks.existingBlockPv")} action={<Button disabled={!available.length || bindings.length >= 8} onClick={() => {
      const volume = available[0]; if (!volume) return;
      const suffix = bindings.length + 1;
      update({ volumeBindings: [...bindings, { volumeId: volume.id, pvName: `block-pv-${suffix}`, pvcName: `data-pvc-${suffix}`, namespace: "default" }] });
    }}>{t("storage.add")}</Button>}>
      <small>{t("eks.blockBindingHint")}</small>
      {volumeQuery.error && <ErrorState error={volumeQuery.error} />}
      {!volumes.length && <p>{t("eks.noEligibleBlock")} <Link to="/storage/block" target="_blank" rel="noreferrer">{t("eks.openBlockStorage")}</Link></p>}
      {bindings.map((binding, index) => <div key={index} className="panel stack" style={{ padding: 14 }}>
        <div className="between"><strong>PV / PVC {index + 1}</strong><Button onClick={() => update({ volumeBindings: bindings.filter((_, i) => i !== index) })}>{t("common.delete")}</Button></div>
        <div className="form-grid">
          <Field label={t("eks.blockVolume")}><select value={binding.volumeId} onChange={(event) => update({ volumeBindings: bindings.map((item, i) => i === index ? { ...item, volumeId: event.target.value } : item) })}>{[...available, ...volumes.filter((volume) => volume.id === binding.volumeId)].map((volume) => <option key={volume.id} value={volume.id}>{volume.name} · {volume.sizeGb} GB · {zoneForVolume(volume)}</option>)}</select></Field>
          <Field label="PV"><input className="input" value={binding.pvName} onChange={(event) => update({ volumeBindings: bindings.map((item, i) => i === index ? { ...item, pvName: event.target.value } : item) })} /></Field>
          <Field label="PVC"><input className="input" value={binding.pvcName} onChange={(event) => update({ volumeBindings: bindings.map((item, i) => i === index ? { ...item, pvcName: event.target.value } : item) })} /></Field>
          <Field label={t("eks.namespace")}><input className="input" value={binding.namespace} onChange={(event) => update({ volumeBindings: bindings.map((item, i) => i === index ? { ...item, namespace: event.target.value } : item) })} /></Field>
        </div>
        <small>{t("eks.rwoHint")}</small>
      </div>)}
    </Panel>
    <Panel title={t("eks.localPv")}>
      <Field label={t("eks.localPvPerNode")} hint={`0–${maxLocal || 0} GB`}><input className="input" type="number" min={0} max={maxLocal || 0} value={spec.localPvGb || 0} onChange={(event) => update({ localPvGb: Number(event.target.value) })} /></Field>
      <small>{t("eks.localPvHint")}</small>
      {(spec.localPvGb || 0) > maxLocal && <p className="field-error">{t("error.INVALID_LOCAL_PV_SIZE")}</p>}
    </Panel>
  </div>;
}

function ClusterNodes({ pools, images }: FormContext) {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const updatePool = (index: number, patch: Partial<VgpuSpec["nodePools"][number]>) => {
    const nodePools = spec.nodePools.map((pool, i) => i === index ? { ...pool, ...patch } : pool);
    update({ nodePools, gpuCount: nodePools.reduce((sum, pool) => sum + pool.nodeCount * pool.gpuPerNode, 0) });
  };
  return <div className="stack"><p>{t("eks.nodeStepIntro")}</p>
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
  const { spec } = useSpec<VgpuSpec>();
  return <div className="stack"><p>{t("eks.addonsStepIntro")}</p>
    <Panel title="GPU Operator / Device Plugin"><KeyValues items={[["GPU Operator", t("eks.managedAddon")], ["Device Plugin", t("eks.managedAddon")], ["NFD", t("eks.managedAddon")]]} /><small>{t("eks.gpuAddonHint")}</small></Panel>
    <Panel title="Ingress"><SpecCheck name="ingressEnabled" label="Ingress" />{spec.ingressEnabled && <SpecSelect name="ingressClass" label="Ingress Class" options={["nginx", "traefik"]} />}</Panel>
    <Panel title={t("eks.accessAndRbac")}><div className="form-grid"><SpecSelect name="kubeconfigAccess" label={t("wizard.accessConfirm")} options={["download", "managed-console"]} /><SpecCheck name="rbacDefaultAdmin" label="RBAC Admin" /></div></Panel>
  </div>;
}

function ClusterConfirm({ context }: { context: FormContext }) {
  const { spec, form } = useSpec<VgpuSpec>();
  const values = form.watch();
  const vpc = useData<DeploymentOptions>(["cluster-network-options", values.region, values.projectId], EP.options + query({ region: values.region, project_id: values.projectId, kind: "vgpu" }));
  const selected = vpc.data?.vpcs.find((item) => item.id === spec.vpc);
  return <div className="stack"><p>{t("eks.confirmStepIntro")}</p>
    <Panel title={t("eks.resourceSummary")}><KeyValues items={[
      [t("common.project"), context.projects.find((project) => project.id === values.projectId)?.name || values.projectId],
      [t("common.region"), t(`common.${values.region}`)], [t("common.name"), values.name],
      [t("resource.k8s"), spec.k8sVersion], [t("wizard.controlPlane"), spec.controlPlaneTier],
      ["VPC", `${selected?.name || spec.vpc} · ${selected?.cidr || ""}`],
      [t("eks.subnetConfig"), selected?.subnets.filter((item) => selectedSubnets(spec).includes(item.id)).map((item) => `${item.name} (${item.zone}, ${item.cidr})`).join(" / ") || spec.subnets?.join(" / ") || "—"],
      ["CNI", spec.networkPlugin], ["Pod / Service CIDR", `${spec.podCidr} / ${spec.serviceCidr}`],
      [t("eks.existingBlockPv"), `${spec.volumeBindings?.length || 0} PV / PVC`],
      [t("eks.localPv"), spec.localPvGb ? `${spec.localPvGb} GB / ${t("common.nodes")}` : "—"],
      [t("cluster.nodePool"), spec.nodePools.map((pool, index) => `${poolName(pool, index)} · ${pool.poolCode} · ${pool.nodeCount} × ${pool.gpuPerNode} GPU`).join(" / ")],
      [t("resource.gpu"), spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount * pool.gpuPerNode, 0)],
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
    <div><strong>Kubernetes · {spec.k8sVersion}</strong><small>CNI {spec.networkPlugin} · {spec.controlPlaneTier}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>{t("cluster.nodePool")} / Pod</strong><small>{t("eks.poolCount", { pools: spec.nodePools.length, nodes: spec.nodePools.reduce((sum, pool) => sum + pool.nodeCount, 0), gpus: gpuCount })}</small></div>
    <div className="cluster-chain-arrow">↓</div>
    <div><strong>CSI → PV → PVC</strong><small>{spec.storageClass} · {spec.volumeBindings?.length || 0} {t("eks.existingBlockPv")} · {spec.localPvGb || 0} GB {t("eks.localPv")}</small></div>
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
