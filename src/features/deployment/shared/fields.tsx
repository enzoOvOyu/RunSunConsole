import { poolDisplayName } from "../../../lib/gpu-labels";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EP, query } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { confirmAction } from "../../../components/ui/ConfirmAction";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useFormContext } from "react-hook-form";
import type {
  Resource,
  DeploymentOptions,
  Pool,
  Kind,
  Region,
  Project,
  Image,
  Model,
  BillingMode,
  ScalingConfig,
} from "../../../types/domain";
import {
  Field,
  Check,
  Button,
  KeyValues,
  Loading,
  ErrorState,
} from "../../../components/ui";
import { t, dt } from "../../../i18n";
import { defaultScaling, normalizeSpec } from "../../../lib/config";
import { formatResourceId } from "../../../lib/ids";
import { SCALING_METRIC_LIMITS } from "../../../lib/schema";
import { vpcNetworkType } from "../../../lib/network";
import { readSshKeys } from "../../../lib/ssh-keys";
import {
  imageArchitectures,
  imageCompatibleWithOs,
  imageFrameworks,
  imageOsFamily,
  imageSupportsArchitecture,
  imageSupportsPool,
} from "./image-compat";
export interface WizardValues {
  projectId: string;
  region: Region;
  name: string;
  nodePool: Pool["code"];
  mode: BillingMode;
  labels: string[];
  spec: Resource["spec"];
  agree: boolean;
  password: string;
}
export interface FormContext {
  kind: Kind;
  step: number;
  pools: Pool[];
  projects: Project[];
  images: Image[];
  models: Model[];
}
export function useSpec<S extends Resource["spec"]>() {
  const form = useFormContext<WizardValues>();
  const spec = form.watch("spec") as S;
  const update = (part: Partial<S>) =>
    form.setValue(
      "spec",
      normalizeSpec({ ...spec, ...part } as Resource["spec"]),
      { shouldDirty: true, shouldValidate: true },
    );
  return { spec, update, form };
}
export function SpecNumber({
  name,
  label,
  min = 0,
  max = 65535,
  help,
}: {
  name: string;
  label: string;
  min?: number;
  max?: number;
  help?: string;
}) {
  const { spec, update } = useSpec();
  const value = (spec as unknown as Record<string, unknown>)[name];
  return (
    <Field label={label} hint={help}>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => update({ [name]: Number(e.target.value) })}
      />
    </Field>
  );
}
export function SpecText({
  name,
  label,
  area = false,
}: {
  name: string;
  label: string;
  area?: boolean;
}) {
  const { spec, update } = useSpec();
  const value = (spec as unknown as Record<string, unknown>)[name];
  const props = {
    className: "input",
    value: typeof value === "string" ? value : "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update({ [name]: e.target.value }),
  };
  return (
    <Field label={label}>
      {area ? <textarea {...props} /> : <input {...props} />}
    </Field>
  );
}
export function SpecSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: (string | { value: string; label: string })[];
}) {
  const { spec, update } = useSpec();
  const value = (spec as unknown as Record<string, unknown>)[name];
  return (
    <Field label={label}>
      <select
        value={String(value)}
        onChange={(e) => update({ [name]: e.target.value })}
      >
        {options.map((o) => (
          <option
            key={typeof o === "string" ? o : o.value}
            value={typeof o === "string" ? o : o.value}
          >
            {typeof o === "string" ? o : o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function SpecCheck({ name, label }: { name: string; label: string }) {
  const { spec, update } = useSpec();
  return (
    <Check
      label={label}
      checked={!!(spec as unknown as Record<string, unknown>)[name]}
      onChange={(value) => update({ [name]: value })}
    />
  );
}
export function ScalingFields({
  kind,
  full = false,
  value,
  onChange,
}: {
  kind: Kind;
  full?: boolean;
  value: ScalingConfig;
  onChange: (value: ScalingConfig) => void;
}) {
  const node = kind !== "inference";
  const set = (part: Partial<ScalingConfig>) => onChange({ ...value, ...part });
  const targetRange = SCALING_METRIC_LIMITS[value.trigger_metric] || {
    min: 1,
    max: 100000,
    unit: "",
  };
  const triggers = node
    ? kind === "gpu_baremetal"
      ? ["gpu_allocation_rate"]
      : kind === "vgpu"
        ? ["pending_pods", "queue_depth", "qpm"]
        : ["queue_depth", "qpm"]
    : ["requests_waiting", "ttft_p99", "kv_cache_usage", "concurrency", "qpm"];
  return (
    <div className="stack">
      <div className="notice warning">{t(`scaling.${kind}`)}</div>
      {node ? (
        <div className="form-grid">
          <Field
            label={t("common.metric")}
            hint={t("scaling." + value.trigger_metric)}
          >
            <select
              value={value.trigger_metric}
              onChange={(e) => set({ trigger_metric: e.target.value })}
            >
              {triggers.map((m) => (
                <option key={m} value={m}>
                  {t("scaling." + m)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`${t("common.target")}${targetRange.unit ? ` · ${targetRange.unit}` : ""}`}
            hint={t("scaling.fieldHelp", {
              min: targetRange.min,
              max: targetRange.max,
            })}
          >
            <input
              type="number"
              className="input"
              min={targetRange.min}
              max={targetRange.max}
              step={1}
              value={value.target_value}
              onChange={(e) => set({ target_value: Number(e.target.value) })}
            />
            {(!Number.isInteger(value.target_value) ||
              value.target_value < targetRange.min ||
              value.target_value > targetRange.max) && (
              <small className="field-error">
                {t("scaling.targetInvalid", {
                  min: targetRange.min,
                  max: targetRange.max,
                  unit: targetRange.unit,
                })}
              </small>
            )}
          </Field>
          <Field
            label={t("common.min")}
            hint={t("scaling.fieldHelp", { min: 1, max: 64 })}
          >
            <input
              className="input"
              type="number"
              min={1}
              max={64}
              value={value.min_size}
              onChange={(e) => set({ min_size: Number(e.target.value) })}
            />
          </Field>
          <Field
            label={t("common.max")}
            hint={t("scaling.fieldHelp", { min: value.min_size, max: 64 })}
          >
            <input
              type="number"
              className="input"
              min={value.min_size}
              max={64}
              value={value.max_size}
              onChange={(e) => set({ max_size: Number(e.target.value) })}
            />
          </Field>
          <Field
            label={t("scaling.protection")}
            hint={kind === "gpu_baremetal" ? "600–1800 s" : "60–3600 s"}
          >
            <input
              type="number"
              className="input"
              min={kind === "gpu_baremetal" ? 600 : 60}
              max={kind === "gpu_baremetal" ? 1800 : 3600}
              value={value.cooldown_s}
              onChange={(e) => set({ cooldown_s: Number(e.target.value) })}
            />
          </Field>
          <Check
            label={t("scaling.fallback")}
            checked={value.fallback_enabled}
            onChange={(v) => set({ fallback_enabled: v })}
          />
        </div>
      ) : (
        <>
          <div className="form-grid">
            <Field
              label={t("common.metric")}
              hint={t("scaling." + value.trigger_metric)}
            >
              <select
                value={value.trigger_metric}
                onChange={(e) => set({ trigger_metric: e.target.value })}
              >
                {triggers.map((m) => (
                  <option key={m} value={m}>
                    {t("scaling." + m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("common.target")}
              hint={t("scaling.fieldHelp", { min: 1, max: 100000 })}
            >
              <input
                className="input"
                type="number"
                min={1}
                max={100000}
                value={value.target_value}
                onChange={(e) => set({ target_value: Number(e.target.value) })}
              />
            </Field>
            <Field
              label={t("common.min") + " · " + t("common.replicas")}
              hint={t("scaling.fieldHelp", {
                min: value.scale_to_zero ? 0 : 1,
                max: 32,
              })}
            >
              <input
                className="input"
                type="number"
                min={value.scale_to_zero ? 0 : 1}
                max={32}
                value={value.min_size}
                onChange={(e) => set({ min_size: Number(e.target.value) })}
              />
            </Field>
            <Field
              label={t("common.max") + " · " + t("common.replicas")}
              hint={t("scaling.fieldHelp", { min: 1, max: 32 })}
            >
              <input
                className="input"
                type="number"
                min={1}
                max={32}
                value={value.max_size}
                onChange={(e) => set({ max_size: Number(e.target.value) })}
              />
            </Field>
            <Field label={t("scaling.drain")} hint="1–3600 s">
              <input
                className="input"
                type="number"
                min={1}
                max={3600}
                value={value.drain_timeout_s}
                onChange={(e) =>
                  set({ drain_timeout_s: Number(e.target.value) })
                }
              />
            </Field>
            <Check
              label={t("scaling.zero")}
              checked={value.scale_to_zero}
              onChange={async (v) => {
                if (!v)
                  set({
                    scale_to_zero: false,
                    min_size: Math.max(1, value.min_size),
                  });
                else if (await confirmAction(t("scaling.zeroConfirm")))
                  set({ scale_to_zero: true });
              }}
            />
          </div>
        </>
      )}
      {full && (
        <div className="form-grid">
          <Field label={t("scaling.warmPool")} hint="0–32">
            <input
              className="input"
              type="number"
              min={0}
              max={32}
              value={value.warm_pool}
              onChange={(e) => set({ warm_pool: Number(e.target.value) })}
            />
          </Field>
          <Field label={t("scaling.cache")}>
            <select
              value={value.weight_cache}
              onChange={(e) => set({ weight_cache: e.target.value })}
            >
              {["page_cache", "shared_memory", "rdma"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label={t("scaling.maintenance")}>
            <input
              className="input"
              value={value.maintenance_window}
              onChange={(e) => set({ maintenance_window: e.target.value })}
            />
          </Field>
          <Field label={t("wizard.canary")} hint="0–99 %">
            <input
              type="number"
              className="input"
              min={0}
              max={99}
              value={value.canary_percent}
              onChange={(e) => set({ canary_percent: Number(e.target.value) })}
            />
          </Field>
          <Check
            label={t("scaling.readiness")}
            checked={value.readiness_gate}
            onChange={(v) => set({ readiness_gate: v })}
          />
        </div>
      )}
    </div>
  );
}
export function ScalingToggle({ kind }: { kind: Kind }) {
  const { spec, update } = useSpec();
  return (
    <section className="panel">
      <div className="panel-body stack">
        <h3>{t("scaling.title")}</h3>
        <Check
          label={t("scaling.enable")}
          checked={!!spec.scaling}
          onChange={async (v) => {
            const initial = defaultScaling(kind);
            const actual =
              "quantity" in spec
                ? spec.quantity
                : "machineCount" in spec
                  ? spec.machineCount
                  : "nodePools" in spec
                    ? spec.nodePools.reduce((a, p) => a + p.nodeCount, 0)
                    : spec.replicas;
            initial.min_size = actual;
            initial.max_size = Math.min(
              kind === "inference" || kind === "gpu_baremetal" ? 32 : 64,
              Math.max(actual, actual * 2),
            );
            update({ scaling: v ? initial : null });
          }}
        />
        {spec.scaling ? (
          <>
            <ScalingFields
              kind={kind}
              value={spec.scaling}
              onChange={(scaling) => update({ scaling })}
            />
            {(() => {
              const actual =
                "quantity" in spec
                  ? spec.quantity
                  : "machineCount" in spec
                    ? spec.machineCount
                    : "nodePools" in spec
                      ? spec.nodePools.reduce(
                          (sum, pool) => sum + pool.nodeCount,
                          0,
                        )
                      : spec.replicas;
              return actual < spec.scaling!.min_size ||
                actual > spec.scaling!.max_size ? (
                <small className="field-error">
                  {t("scaling.rangeMustIncludeCurrent", { actual })}
                </small>
              ) : null;
            })()}
          </>
        ) : (
          <small>{t(`scaling.${kind}`)}</small>
        )}
      </div>
    </section>
  );
}
export function ImageCards({
  images,
  os = false,
  runtime = false,
  architecture,
  gpuModel,
  osFamily,
}: {
  images: Image[];
  os?: boolean;
  runtime?: boolean;
  architecture?: "x86_64" | "aarch64";
  gpuModel?: Pool["code"];
  osFamily?: string;
}) {
  const { spec, update } = useSpec();
  const field = runtime ? "runtimeImageRef" : "imageRef";
  const selected =
    field in spec
      ? String((spec as unknown as Record<string, unknown>)[field] || "")
      : "";
  const compatible = images.filter(
    (image) =>
      image.type === (runtime ? "container" : os ? "os" : image.type) &&
      (!architecture || imageSupportsArchitecture(image, architecture)) &&
      (!gpuModel || imageSupportsPool(image, gpuModel)) &&
      (!runtime || !osFamily || imageCompatibleWithOs(image, osFamily)),
  );
  return (
    <section className="stack">
      <h3>
        {t(runtime ? "images.runtimeTemplates" : "images.baseOperatingSystem")}
      </h3>
      <div className="grid grid-2">
        {runtime && (
          <button
            type="button"
            className={`catalog-card ${selected === "" ? "selected" : ""}`}
            onClick={() => update({ runtimeImageRef: "" })}
          >
            <strong>{t("images.noRuntime")}</strong>
            <small>{t("images.noRuntimeDescription")}</small>
          </button>
        )}
        {compatible.map((image) => (
          <button
            type="button"
            className={`catalog-card ${selected === image.id ? "selected" : ""}`}
            key={image.id}
            onClick={() => {
              if (runtime) update({ runtimeImageRef: image.id });
              else {
                const activeRuntime = images.find(
                  (candidate) =>
                    candidate.id ===
                    (spec as unknown as Record<string, unknown>)
                      .runtimeImageRef,
                );
                const runtimeFits =
                  activeRuntime &&
                  imageCompatibleWithOs(activeRuntime, imageOsFamily(image)) &&
                  (!architecture ||
                    imageSupportsArchitecture(activeRuntime, architecture)) &&
                  (!gpuModel || imageSupportsPool(activeRuntime, gpuModel));
                update({
                  imageRef: image.id,
                  ...(runtimeFits ? {} : { runtimeImageRef: "" }),
                });
              }
            }}
          >
            <strong>{image.name}</strong>
            <small>
              {t("images.cpuArchitecture")}:{" "}
              {imageArchitectures(image).join(" / ")}
              {runtime ? ` · ${image.sizeGb} GB` : ""}
            </small>
            <small>
              {t("images.gpuDriver")}:{" "}
              {image.driverVersion || t("images.hostDriver")} · CUDA{" "}
              {image.cudaVersion}
            </small>
            <small>
              {t("images.frameworksIncluded")}:{" "}
              {imageFrameworks(image).length
                ? imageFrameworks(image).join(", ")
                : t("images.noneIncluded")}
            </small>
            {runtime && (
              <small>
                {t("images.compatibleOperatingSystems")}:{" "}
                {(Array.isArray(image.compatibleOsFamilies)
                  ? image.compatibleOsFamilies
                  : ["Ubuntu", "Rocky Linux", "Debian"]
                ).join(", ")}
              </small>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

export function NetworkFields({
  dedicatedBaremetal = false,
}: {
  dedicatedBaremetal?: boolean;
}) {
  const { form, spec, update } = useSpec();
  const region = form.watch("region"),
    projectId = form.watch("projectId");
  const options = useData<DeploymentOptions>(
    ["deployment-network", region, projectId, dedicatedBaremetal],
    EP.options +
      query({
        region,
        project_id: projectId,
        kind: dedicatedBaremetal ? "gpu_baremetal" : undefined,
      }),
    { enabled: !!projectId },
  );
  const availableVpcs = useMemo(
    () =>
      (options.data?.vpcs || []).filter((vpc) =>
        dedicatedBaremetal
          ? vpcNetworkType(vpc) === "baremetal"
          : vpcNetworkType(vpc) !== "baremetal",
      ),
    [options.data?.vpcs, dedicatedBaremetal],
  );
  const vpcId = spec.vpc || "";
  const instanceQuantity = "quantity" in spec ? spec.quantity : 0;
  const selected = availableVpcs.find((v) => v.id === vpcId);
  const groups =
    options.data?.securityGroups.filter((g) => g.vpcId === vpcId) || [];
  useEffect(() => {
    if (!options.data) return;
    const current = form.getValues("spec");
    const vpc =
      availableVpcs.find((v) => v.id === current.vpc) || availableVpcs[0];
    if (!vpc) return;
    const subnet =
      vpc.subnets.find((s) => s.id === current.subnet) || vpc.subnets[0];
    const available = options.data.securityGroups.filter(
      (g) => g.vpcId === vpc.id,
    );
    const changedVpc = current.vpc !== vpc.id;
    const validGroups = (current.securityGroups || []).filter((id) =>
      available.some((g) => g.id === id),
    );
    const nextGroups =
      changedVpc || !current.securityGroups
        ? available.slice(0, 1).map((g) => g.id)
        : validGroups;
    if (
      changedVpc ||
      current.subnet !== subnet?.id ||
      JSON.stringify(current.securityGroups) !== JSON.stringify(nextGroups)
    )
      form.setValue(
        "spec",
        {
          ...current,
          vpc: vpc.id,
          subnet: subnet?.id || "",
          securityGroups: nextGroups,
          eipId: undefined,
        },
        { shouldValidate: true },
      );
  }, [options.data, form, availableVpcs]);
  useEffect(() => {
    const current = form.getValues("spec");
    if (
      current.eipId &&
      (!current.publicIp ||
        !("quantity" in current) ||
        current.quantity !== 1 ||
        (current.scaling?.max_size || 1) > 1)
    ) {
      form.setValue("spec.eipId", undefined, { shouldValidate: true });
    }
  }, [
    form,
    spec.publicIp,
    spec.eipId,
    instanceQuantity,
    spec.scaling?.max_size,
  ]);
  if (options.isPending) return <Loading />;
  if (options.error) return <ErrorState error={options.error} />;
  const vm = "gpuPerInstance" in spec;
  return (
    <div className="stack">
      <div className="notice">
        {t("network.deploymentScope")} ·{" "}
        <Link to={`/network/vpcs?region=${region}&project_id=${projectId}`}>
          {t("network.createVpc")}
        </Link>
      </div>
      <div className="form-grid">
        <Field
          label="VPC"
          hint={
            dedicatedBaremetal ? t("network.baremetalVpcNotice") : undefined
          }
        >
          <select
            aria-label="VPC"
            value={vpcId}
            onChange={(e) => {
              const v = availableVpcs.find((v) => v.id === e.target.value)!;
              update({
                vpc: v.id,
                subnet: v.subnets[0]?.id || "",
                securityGroups: options.data.securityGroups
                  .filter((g) => g.vpcId === v.id)
                  .slice(0, 1)
                  .map((g) => g.id),
                eipId: undefined,
              });
            }}
          >
            <option value="">{t("network.select")}</option>
            {availableVpcs.map((v) => (
              <option key={v.id} value={v.id}>
                {t(
                  vpcNetworkType(v) === "baremetal"
                    ? "network.vpcTypeBaremetal"
                    : "network.vpcTypeStandard",
                )}{" "}
                · {dt(v.name)} · {v.cidr}
              </option>
            ))}
          </select>
          {!vpcId && (
            <small className="field-error">{t("wizard.vpcRequired")}</small>
          )}
        </Field>
        <Field label={t("field.subnet")}>
          <select
            aria-label={t("field.subnet")}
            value={spec.subnet || ""}
            onChange={(e) => update({ subnet: e.target.value })}
          >
            <option value="">{t("network.select")}</option>
            {selected?.subnets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.cidr} ·{" "}
                {t("network.availableIp", { count: s.availableIps })}
              </option>
            ))}
          </select>
          {!spec.subnet && (
            <small className="field-error">{t("wizard.subnetRequired")}</small>
          )}
        </Field>
        <Field label={t("field.securityGroups")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="input row"
                aria-label={t("field.securityGroups")}
                aria-haspopup="menu"
                disabled={!groups.length}
              >
                <span>
                  {groups.length
                    ? (spec.securityGroups || [])
                        .map(
                          (id) => groups.find((group) => group.id === id)?.name,
                        )
                        .filter(Boolean)
                        .map((name) => dt(name!))
                        .join(", ") || t("network.selectSecurityGroups")
                    : t("network.noSecurityGroups")}
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-64">
              {groups.map((group) => {
                const checked = (spec.securityGroups || []).includes(group.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={group.id}
                    checked={checked}
                    disabled={
                      !checked && (spec.securityGroups || []).length >= 5
                    }
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(nextChecked) =>
                      update({
                        securityGroups: nextChecked
                          ? [...(spec.securityGroups || []), group.id].slice(
                              0,
                              5,
                            )
                          : (spec.securityGroups || []).filter(
                              (id) => id !== group.id,
                            ),
                      })
                    }
                  >
                    <span className="stack" style={{ gap: 2 }}>
                      <span>{dt(group.name)}</span>
                      {group.description && <small>{group.description}</small>}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {!groups.length && (
            <small className="muted">{t("network.noSecurityGroups")}</small>
          )}
          {!spec.securityGroups?.length && (
            <small className="field-error">
              {t("wizard.securityGroupRequired")}
            </small>
          )}
        </Field>
        {vm && (
          <div className="stack">
            <SpecCheck name="publicIp" label={t("wizard.publicIp")} />
            {spec.publicIp && (
              <>
                <p className="muted">{t("network.eipIndependent")}</p>
                {spec.quantity === 1 && (spec.scaling?.max_size || 1) <= 1 && (
                  <Field label={t("network.eipChoice")}>
                    <select
                      aria-label={t("network.eipChoice")}
                      value={spec.eipId || ""}
                      onChange={(e) =>
                        update({ eipId: e.target.value || undefined })
                      }
                    >
                      <option value="">{t("network.eipNew")}</option>
                      {options.data.eips.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.address} · {e.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export function DeploymentOptionSelect({
  name,
  label,
}: {
  name: string;
  label: string;
}) {
  const { form } = useSpec();
  const region = form.watch("region");
  const options = useData<DeploymentOptions>(
    ["deployment-options", region],
    EP.options + query({ region }),
  );
  return (
    <SpecSelect
      name={name}
      label={label}
      options={options.data?.k8sVersions || []}
    />
  );
}
export function Review() {
  const { form } = useSpec();
  const projects = useData<Project[]>(["projects"], EP.projects);
  const images = useData<Image[]>(["images"], EP.images);
  const values = form.watch();
  const spec = values.spec;
  const renderValue = (key: string, value: unknown) => {
    if (typeof value === "boolean")
      return t(value ? "common.enabled" : "common.disabled");
    if (
      (key === "machineType" || key === "nodePool") &&
      typeof value === "string"
    )
      return poolDisplayName(value);
    if (value === null || value === undefined || value === "") return "—";
    if (key === "runtimeImageRef") {
      const image = images.data?.find((item) => item.id === value);
      return image ? dt(image.name) : "—";
    }
    if (Array.isArray(value)) {
      if (key === "nodePools")
        return value
          .map(
            (pool) =>
              `${poolDisplayName(pool.poolCode)} · ${pool.nodeCount} ${t("common.nodes")} · ${pool.slicingPolicy} ${pool.migProfile}`,
          )
          .join(" / ");
      return value.join(", ");
    }
    if (typeof value === "object") {
      if (key === "scaling") {
        const config = value as ScalingConfig;
        return `${t("scaling." + config.strategy_model)} · ${config.min_size}–${config.max_size} · ${t("scaling." + config.trigger_metric)} ${config.target_value}`;
      }
      return Object.entries(value)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
    }
    return String(value);
  };
  return (
    <div className="stack">
      <p>{t("wizard.review")}</p>
      <KeyValues
        items={[
          [
            t("common.project"),
            dt(
              projects.data?.find((p) => p.id === values.projectId)?.name ||
                values.projectId,
            ),
          ],
          [t("common.region"), t("common." + values.region)],
          [t("common.name"), values.name],
          ...Object.entries(spec)
            .filter(
              ([key, value]) =>
                !("gpuPerInstance" in spec) ||
                (key !== "env" &&
                  key !== "entrypoint" &&
                  (key !== "runtimeImageRef" ||
                    (!!value &&
                      images.data?.some((image) => image.id === value)))),
            )
            .map(([key, value]): [string, string] => [
              "gpuPerInstance" in spec && key === "vcpu"
                ? t("images.vcpuPerInstance")
                : "gpuPerInstance" in spec && key === "memoryGb"
                  ? t("images.memoryPerInstance")
                  : "gpuPerInstance" in spec && key === "gpuCount"
                    ? t("images.totalGpuCount")
                    : key === "runtimeImageRef"
                      ? t("wizard.runtimeImage")
                      : t("field." + key),
              renderValue(key, value),
            ]),
        ]}
      />
      <Check
        label={t("wizard.agreement")}
        checked={values.agree}
        onChange={(v) => form.setValue("agree", v)}
      />
    </div>
  );
}
export function ProjectSelect({
  projects,
  onCreate,
}: {
  projects: Project[];
  onCreate: () => void;
}) {
  const form = useFormContext<WizardValues>();
  return (
    <div className="row">
      <select aria-label={t("common.project")} {...form.register("projectId")}>
        <option value="">{t("common.project")}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {dt(p.name)} · {formatResourceId("prj", p.id)}
          </option>
        ))}
      </select>
      <Button onClick={onCreate}>{t("wizard.projectNew")}</Button>
    </div>
  );
}

export function SshKeySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (publicKey: string) => void;
}) {
  const [keys, setKeys] = useState(readSshKeys);
  useEffect(() => {
    const refresh = () => setKeys(readSshKeys());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  return (
    <div className="stack">
      <Field label={t("wizard.sshKey")}>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t("wizard.sshKey")}
        >
          <option value="">{t("wizard.selectSshKey")}</option>
          {keys.map((key) => (
            <option key={key.id} value={key.publicKey}>
              {key.name}
            </option>
          ))}
        </select>
      </Field>
      <small>
        {t("wizard.noSshKey")}{" "}
        <Link to="/workbench/ssh-keys" target="_blank" rel="noreferrer">
          {t("wizard.manageSshKeys")}
        </Link>
      </small>
    </div>
  );
}
