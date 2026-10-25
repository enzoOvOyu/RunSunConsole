import { useState } from "react";
import { Link } from "react-router-dom";
import { EP, query } from "../../lib/api-client";
import { formatResourceId } from "../../lib/ids";
import { money, unitMoney } from "../../lib/money";
import { vpcNetworkType } from "../../lib/network";
import type { DeploymentOptions, SliceCatalogItem, VgpuSpec } from "../../types/domain";
import { t } from "../../i18n";
import { ErrorState, Field, KeyValues, Loading, Panel } from "../../components/ui";
import { useData } from "../shared/hooks";
import { useSpec } from "./shared/fields";
import { useDeploymentEstimate } from "../shared/useDeploymentEstimate";

export function ClusterModeSelector() {
  const { spec, form } = useSpec<VgpuSpec>();
  const mode = spec.deploymentMode || "exclusive";
  const region = form.watch("region"), projectId = form.watch("projectId");
  const catalog = useData<SliceCatalogItem[]>(["slice-catalog", region, projectId],
    EP.slices + query({ region, project_id: projectId }), { enabled: !!projectId });
  const choose = (next: "exclusive" | "slice") => {
    if (next === mode || (next === "slice" && !catalog.data?.length)) return;
    const drafts = { ...form.getValues("clusterModeDrafts"), [mode]: spec };
    const saved = drafts[next];
    const nextSpec: VgpuSpec = saved || (next === "slice" ? {
      ...spec, deploymentMode: "slice", slice: undefined, nodePools: [], gpuCount: 0,
      k8sVersion: catalog.data![0].k8sVersion,
      scaling: null, apiServerPublic: false, authorizedCidr: "", ingressEnabled: false,
      ingressClass: "", rbacDefaultAdmin: false, controlPlaneTier: "standard",
      podCidr: "", serviceCidr: "", localPvGb: 0, storageMode: "dynamic_block",
      storageClass: "ssd", defaultPvcGb: 100, storageGb: 100,
      securityGroups: [], ports: [],
    } : { ...spec, deploymentMode: "exclusive" });
    form.setValue("clusterModeDrafts", drafts, { shouldDirty: true });
    const billing = { ...form.getValues("clusterModeBilling"), [mode]: form.getValues("mode") };
    form.setValue("clusterModeBilling", billing, { shouldDirty: true });
    form.setValue("mode", billing[next] || "on_demand", { shouldDirty: true });
    const poolCodes = { ...form.getValues("clusterModePools"), [mode]: form.getValues("nodePool") };
    form.setValue("clusterModePools", poolCodes, { shouldDirty: true });
    form.setValue("nodePool", poolCodes[next] || (next === "exclusive" ? nextSpec.nodePools[0]?.poolCode || form.getValues("nodePool") : catalog.data![0].poolCode), { shouldDirty: true });
    form.setValue("spec", nextSpec, { shouldDirty: true, shouldValidate: true });
  };
  return <Panel title={t("slice.modeTitle")}>
    <div className="grid grid-2">
      {(["exclusive", "slice"] as const).map((item) => <button key={item} type="button"
        className={`catalog-card ${mode === item ? "selected" : ""}`}
        disabled={item === "slice" && !catalog.data?.length}
        aria-pressed={mode === item} onClick={() => choose(item)}>
        <strong>{t(`slice.${item}`)}</strong><small>{t(`slice.${item}Hint`)}</small>
      </button>)}
    </div>
  </Panel>;
}

export function SliceConfiguration() {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const region = form.watch("region"), projectId = form.watch("projectId");
  const price = useDeploymentEstimate({ kind: "vgpu", region, nodePool: form.watch("nodePool"), mode: form.watch("mode"), spec });
  const catalog = useData<SliceCatalogItem[]>(["slice-catalog", region, projectId],
    EP.slices + query({ region, project_id: projectId }), { enabled: !!projectId, poll: true, pollMs: 5000 });
  const [model, setModel] = useState(""), [profile, setProfile] = useState(""), [memory, setMemory] = useState(""), [availableOnly, setAvailableOnly] = useState(false);
  if (catalog.isPending) return <Loading />;
  if (catalog.error) return <ErrorState error={catalog.error} />;
  const items = catalog.data || [];
  const selected = items.find((item) => item.id === spec.slice?.skuId);
  const available = selected ? Math.max(0, Math.min(selected.free, selected.projectLimit - selected.projectUsed, 64)) : 0;
  const models = [...new Set(items.map((item) => item.gpuModel))];
  const profiles = [...new Set(items.map((item) => item.profile))];
  const memoryOptions = [...new Set(items.map((item) => item.memoryGb))].sort((a, b) => a - b);
  const shown = items.filter((item) => (!model || item.gpuModel === model) && (!profile || item.profile === profile) &&
    (!memory || item.memoryGb >= Number(memory)) && (!availableOnly || item.free > 0));
  return <div className="stack">
    <p>{t("slice.mockBoundary")}</p>
    <Panel title={t("slice.skuTitle")}>
      <div className="form-grid">
        <Field label={t("slice.gpuModel")}><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">{t("slice.all")}</option>{models.map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label={t("slice.profile")}><select value={profile} onChange={(event) => setProfile(event.target.value)}><option value="">{t("slice.all")}</option>{profiles.map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label={t("slice.memory")}><select value={memory} onChange={(event) => setMemory(event.target.value)}><option value="">{t("slice.all")}</option>{memoryOptions.map((value) => <option key={value} value={value}>{value} GB+</option>)}</select></Field>
      </div>
      <label className="row"><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />{t("slice.availableOnly")}</label>
      <div className="grid grid-2">
        {shown.map((sku) => <button type="button" key={sku.id}
          disabled={sku.free === 0 || sku.hourlyUsd === null || sku.projectUsed >= sku.projectLimit}
          aria-pressed={selected?.id === sku.id}
          className={`catalog-card ${selected?.id === sku.id ? "selected" : ""}`}
          onClick={() => {
            update({ slice: { skuId: sku.id, count: 1 }, k8sVersion: sku.k8sVersion });
            form.setValue("nodePool", sku.poolCode, { shouldDirty: true });
          }}>
          <strong>{sku.gpuModel} · {sku.profile}</strong>
          <small>{sku.id} · {sku.memoryGb} GB HBM · {sku.isolation}</small>
          <small>{t("slice.layout")}: {sku.layoutId} · {sku.kubernetesResource}</small>
          <small>Kubernetes {sku.k8sVersion} · GPU Operator {sku.gpuOperator} · {sku.driverBranch} · {sku.cudaBaseline}</small>
          <small>{t("slice.workloads")}: {sku.workload}</small>
          <small>{t("slice.physicalAndCreated", { gpus: sku.physicalGpus, instances: sku.createdInstances })}</small>
          <small>{t("slice.inventory", { free: sku.free, reserved: sku.reserved, allocated: sku.allocated, maintenance: sku.maintenance })}</small>
          <strong>{sku.hourlyUsd === null ? t("slice.noQuote") : `${unitMoney(sku.hourlyUsd)} / ${t("slice.hour")}`}</strong>
        </button>)}
      </div>
      {shown.length === 0 && <p>{t("slice.noSku")}</p>}
    </Panel>
    {selected && <Panel title={t("slice.quantityTitle")}>
      <div className="form-grid"><Field label={t("slice.quantity")}><input className="input" type="number" min={1} max={available}
        value={spec.slice?.count ?? 1} onChange={(event) => update({ slice: { skuId: selected.id, count: Number(event.target.value) } })} />
        {(!Number.isInteger(spec.slice?.count) || (spec.slice?.count || 0) < 1 || (spec.slice?.count || 0) > available) &&
          <small className="field-error">{t("slice.insufficient", { max: available })}</small>}
      </Field></div>
      <KeyValues items={[[t("slice.free"), selected.free], [t("slice.reserved"), selected.reserved],
        [t("slice.projectQuota"), `${selected.projectUsed} / ${selected.projectLimit}`],
        [t("slice.maxRequest"), available],
        [t("slice.hourly"), selected.hourlyUsd === null ? t("slice.noQuote") : price.data ? money(price.data.lines.filter((line) => line.key.startsWith("slice:")).reduce((sum, line) => sum + line.hourly, 0)) : "—"]]} />
    </Panel>}
  </div>;
}

export function SliceNetwork() {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const region = form.watch("region"), projectId = form.watch("projectId");
  const options = useData<DeploymentOptions>(["cluster-network-options", region, projectId],
    EP.options + query({ region, project_id: projectId, kind: "vgpu" }), { enabled: !!projectId });
  if (options.isPending) return <Loading />;
  if (options.error) return <ErrorState error={options.error} />;
  const vpcs = (options.data?.vpcs || []).filter((item) => vpcNetworkType(item) === "standard");
  const vpc = vpcs.find((item) => item.id === spec.vpc);
  return <div className="stack"><p>{t("slice.networkHint")}</p>
    <Panel title={t("eks.vpcConfig")}>
      <Field label="VPC"><select value={vpc?.id || ""} onChange={(event) => {
        const next = vpcs.find((item) => item.id === event.target.value);
        update({ vpc: next?.id || "", subnet: next?.subnets[0]?.id || "", subnets: next?.subnets[0] ? [next.subnets[0].id] : [], securityGroups: [] });
      }}><option value="">{t("network.select")}</option>{vpcs.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatResourceId("vpc", item.id)} · {item.cidr}</option>)}</select></Field>
      {vpc && <Field label={t("eks.subnetConfig")}><select value={spec.subnet || ""} onChange={(event) => update({ subnet: event.target.value, subnets: [event.target.value] })}>
        {vpc.subnets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.zone} · {item.cidr}</option>)}
      </select></Field>}
      {!vpcs.length && <p className="field-error">{t("slice.noVpc")} <Link to="/network/vpcs" target="_blank" rel="noreferrer">{t("network.createVpc")}</Link></p>}
    </Panel>
    <Panel title={t("slice.namespaceBoundary")}><p>{t("slice.networkIsolationMock")}</p></Panel>
  </div>;
}

export function SliceStorage() {
  const { spec, update } = useSpec<VgpuSpec>();
  return <div className="stack"><p>{t("slice.storageHint")}</p>
    <Panel title={t("eks.chooseStorageScheme")}><div className="grid grid-2">
      {(["dynamic_block", "shared_file"] as const).map((mode) => <button key={mode} type="button" aria-pressed={spec.storageMode === mode}
        className={`catalog-card ${spec.storageMode === mode ? "selected" : ""}`}
        onClick={() => update({ storageMode: mode, storageClass: mode === "shared_file" ? "shared-fs" : "ssd", defaultPvcGb: 100, storageGb: 100 })}>
        <strong>{t(`eks.storageMode.${mode}`)}</strong><small>{t(`eks.storageModeHint.${mode}`)}</small>
      </button>)}
    </div></Panel>
    <Panel title={t("eks.requestedCapacity")}><Field label={t("slice.pvcCapacity")}><input className="input" type="number" min={1} max={32768}
      value={spec.defaultPvcGb} onChange={(event) => update({ defaultPvcGb: Number(event.target.value) })} />
      {(!Number.isInteger(spec.defaultPvcGb) || spec.defaultPvcGb < 1 || spec.defaultPvcGb > 32768) && <small className="field-error">{t("slice.capacityInvalid")}</small>}
    </Field><small>{t("slice.pvcHint")}</small></Panel>
  </div>;
}

export function SliceAccess() {
  return <div className="stack"><Panel title={t("slice.namespaceBoundary")}>
    <KeyValues items={[[t("slice.accessScope"), t("slice.namespaceRbac")], [t("slice.gpuResource"), t("slice.devicePluginManaged")], [t("slice.ingress"), t("slice.internalOnly")]]} />
    <small>{t("slice.accessMock")}</small>
  </Panel></div>;
}
