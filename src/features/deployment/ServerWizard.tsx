import { StorageRows } from "./shared/StorageRows";
import { validResourcePassword } from "../../lib/password-policy";
import { useEffect } from "react";
import { gpuModelDisplayName } from "../../lib/gpu-labels";
import {
  isWindowsImage,
  WINDOWS_LOGIN_USER,
  WINDOWS_MIN_SYSTEM_DISK_GB,
  WINDOWS_RDP_PORT,
} from "../../lib/windows-image";
import {
  imageCompatibleWithOs,
  imageOsFamily,
  imageSupportsArchitecture,
  imageSupportsPool,
} from "./shared/image-compat";
import { z } from "zod";
import type { ServerSpec } from "../../types/domain";
import { t } from "../../i18n";
import { Field } from "../../components/ui";
import { serverSchema, storageSelectionsSchema } from "../../lib/schema";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec,
  SpecNumber,
  SpecSelect,
  SshKeySelect,
  ImageCards,
  NetworkFields,
  Review,
  ScalingToggle,
  type FormContext,
  type WizardValues,
} from "./shared/fields";
function validate(
  v: WizardValues,
  step: number,
  lookups?: { images: FormContext["images"]; serverFlavors?: FormContext["serverFlavors"]; gpuCounts?: number[] },
) {
  const s = v.spec as ServerSpec;
  const windows = isWindowsImage(
    lookups?.images.find((image) => image.id === s.imageRef),
  );
  if (step === 1)
    return !!lookups?.gpuCounts?.includes(s.gpuPerInstance) &&
      !!lookups.serverFlavors?.some((flavor) => flavor.vcpu === s.vcpu && flavor.memoryGb === s.memoryGb);
  if (step === 2)
    return (
      z
        .object({
          imageRef: z.string().min(1),
          systemDiskGb: z.number().min(windows ? WINDOWS_MIN_SYSTEM_DISK_GB : 40).max(2048),
          dataDiskGb: z.number().min(0).max(32768),
        })
        .safeParse(s).success &&
      storageSelectionsSchema.safeParse(s.storageSelections || []).success &&
      (!windows || !s.runtimeImageRef)
    );
  if (step === 3)
    return (
      (!windows || s.authMethod === "password") &&
      (s.authMethod === "password"
        ? validResourcePassword(v.password)
        : z
            .string()
            .regex(/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/)
            .safeParse(s.sshPubkey).success) &&
      !!s.vpc &&
      !!s.subnet &&
      s.securityGroups.length > 0 &&
      Number.isInteger(s.bandwidthMbps) &&
      s.bandwidthMbps >= 1 &&
      s.bandwidthMbps <= 1000
    );
  return serverSchema.safeParse(s).success;
}
function ServerForm({ step, pools, images, serverFlavors, gpuCounts }: FormContext) {
  const { spec, update, form } = useSpec<ServerSpec>();
  const selected = form.watch("nodePool");
  const selectedPool = pools.find((pool) => pool.code === selected);
  const password = form.watch("password") || "";
  const baseImage = images.find((image) => image.id === spec.imageRef);
  const windows = isWindowsImage(baseImage);
  useEffect(() => {
    if (!serverFlavors.length) return;
    const flavor = serverFlavors.reduce((best, item) => Math.abs(item.vcpu - spec.vcpu) < Math.abs(best.vcpu - spec.vcpu) ? item : best);
    if (spec.vcpu !== flavor.vcpu || spec.memoryGb !== flavor.memoryGb)
      update({ vcpu: flavor.vcpu, memoryGb: flavor.memoryGb });
  }, [serverFlavors, spec.vcpu, spec.memoryGb, update]);
  useEffect(() => {
    if (!images.length || !selectedPool) return;
    const current = images.find((image) => image.id === spec.imageRef);
    const isEligible = (image: (typeof images)[number]) =>
      image.type === "os" &&
      imageSupportsPool(image, selectedPool.code) &&
      imageSupportsArchitecture(image, selectedPool.cpuArchitecture);
    if (current && isEligible(current)) return;
    const fallback = images.find(isEligible);
    if (fallback) update({ imageRef: fallback.id, runtimeImageRef: "" });
  }, [images, selectedPool, spec.imageRef, update]);
  useEffect(() => {
    if (!baseImage) return;
    if (windows) {
      const changes: Partial<ServerSpec> = {};
      if (spec.authMethod !== "password") changes.authMethod = "password";
      if (spec.sshPubkey) changes.sshPubkey = "";
      if (spec.runtimeImageRef) changes.runtimeImageRef = "";
      if (spec.ports?.length !== 1 || spec.ports[0] !== WINDOWS_RDP_PORT)
        changes.ports = [WINDOWS_RDP_PORT];
      if (spec.systemDiskGb < WINDOWS_MIN_SYSTEM_DISK_GB)
        changes.systemDiskGb = WINDOWS_MIN_SYSTEM_DISK_GB;
      if (Object.keys(changes).length) update(changes);
    } else if (spec.ports?.includes(WINDOWS_RDP_PORT)) {
      update({ ports: [22, 8888] });
    }
  }, [
    baseImage,
    windows,
    spec.authMethod,
    spec.sshPubkey,
    spec.runtimeImageRef,
    spec.ports,
    spec.systemDiskGb,
    update,
  ]);
  return step === 1 ? (
    <div className="stack">
      <PoolCards
        kind="gpu_vm"
        pools={pools}
        selected={selected}
        onSelect={(p) => {
          form.setValue("nodePool", p.code);
          const fits = (image: (typeof images)[number]) =>
            imageSupportsPool(image, p.code) &&
            imageSupportsArchitecture(image, p.cpuArchitecture);
          const baseImage = images.find((image) => image.id === spec.imageRef);
          const nextImage =
            baseImage && fits(baseImage)
              ? baseImage
              : images.find((image) => image.type === "os" && fits(image));
          const runtimeImage = images.find(
            (image) => image.id === spec.runtimeImageRef,
          );
          const runtimeFits =
            runtimeImage &&
            nextImage &&
            fits(runtimeImage) &&
            imageCompatibleWithOs(runtimeImage, imageOsFamily(nextImage));
          update({
            gpuModel: gpuModelDisplayName(p.gpuModel),
            gpuCount: spec.gpuPerInstance * spec.quantity,
            imageRef: nextImage?.id || "",
            runtimeImageRef: runtimeFits ? runtimeImage.id : "",
          });
        }}
      />
      <div className="form-grid">
        <Field label={t("resource.gpu")}>
          <select
            value={spec.gpuPerInstance}
            onChange={(e) => {
              const n = Number(e.target.value);
              update({
                gpuPerInstance: n,
                gpuCount: n * spec.quantity,
              });
            }}
          >
            {gpuCounts.filter((count) => count <= (selectedPool?.gpusPerNode || 0)).map((n) => (
              <option key={n} value={n}>
                {n} GPU
              </option>
            ))}
          </select>
        </Field>
        <Field label="vCPU" hint={t("wizard.vcpuHint")}>
          <select
            value={spec.vcpu}
            onChange={(event) => {
              const vcpu = Number(event.target.value);
              const flavor = serverFlavors.find((flavor) => flavor.vcpu === vcpu);
              if (flavor) update(flavor);
            }}
          >
            {serverFlavors.map(
              ({ vcpu }) => (
                <option key={vcpu} value={vcpu}>
                  {vcpu} vCPU
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label={t("wizard.memoryForCpu")} hint={t("wizard.memoryRatio")}>
          <input
            className="input"
            type="number"
            value={spec.memoryGb}
            readOnly
            aria-readonly="true"
          />
        </Field>
        <small className="mono">
          gpu.{spec.gpuPerInstance}x{selected.toLowerCase()}.{spec.vcpu}c.
          {spec.memoryGb}g
        </small>
      </div>
    </div>
  ) : step === 2 ? (
    <div className="stack">
      <ImageCards
        images={images}
        os
        architecture={selectedPool?.cpuArchitecture}
        gpuModel={selectedPool?.code}
      />
      {!windows && (
        <ImageCards
          images={images}
          runtime
          architecture={selectedPool?.cpuArchitecture}
          gpuModel={selectedPool?.code}
          osFamily={baseImage ? imageOsFamily(baseImage) : undefined}
        />
      )}
      {windows && <p className="notice">{t("images.windowsRuntimeHint")}</p>}
      <div className="form-grid">
        <SpecNumber
          name="systemDiskGb"
          label={t("wizard.systemDisk")}
          min={windows ? WINDOWS_MIN_SYSTEM_DISK_GB : 40}
          max={2048}
        />
        <SpecSelect
          name="systemDiskType"
          label={t("common.type")}
          options={["nvme_ssd", "ssd"]}
        />
        <SpecNumber
          name="dataDiskGb"
          label={t("wizard.dataDisk")}
          max={32768}
        />
        <SpecSelect
          name="dataDiskType"
          label={t("common.type")}
          options={["nvme_ssd", "ssd"]}
        />
      </div>
      <StorageRows />
    </div>
  ) : step === 3 ? (
    <div className="stack">
      <NetworkFields />
      {windows ? (
        <Field label={t("field.authMethod")} hint={t("images.windowsRdpHint")}>
          <input
            className="input"
            value={t("images.windowsPasswordLogin", {
              user: WINDOWS_LOGIN_USER,
              port: WINDOWS_RDP_PORT,
            })}
            readOnly
          />
        </Field>
      ) : (
        <SpecSelect
          name="authMethod"
          label={t("field.authMethod")}
          options={[
            { value: "ssh_key", label: t("wizard.sshKey") },
            { value: "password", label: t("wizard.password") },
          ]}
        />
      )}
      {spec.authMethod === "password" ? (
        <Field
          label={t("wizard.password")}
          hint={validResourcePassword(password) ? t("wizard.passwordRule") : undefined}
          error={!validResourcePassword(password) ? t(password ? "wizard.passwordRule" : "wizard.passwordRequired") : undefined}
        >
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            aria-invalid={!validResourcePassword(password)}
            {...form.register("password")}
          />
        </Field>
      ) : (
        <>
          <SshKeySelect
            value={spec.sshPubkey}
            onChange={(sshPubkey) => update({ sshPubkey })}
          />
          {!/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/.test(spec.sshPubkey) && (
            <small className="field-error">{t("wizard.sshKeyRequired")}</small>
          )}
        </>
      )}
      <div className="stack">
        <SpecNumber
          name="bandwidthMbps"
          label={t("wizard.bandwidth")}
          min={1}
          max={1000}
          help={t("wizard.bandwidthHint")}
        />
        {(!Number.isInteger(spec.bandwidthMbps) ||
          spec.bandwidthMbps < 1 ||
          spec.bandwidthMbps > 1000) && (
          <small className="field-error">{t("wizard.bandwidthInvalid")}</small>
        )}
      </div>
    </div>
  ) : (
    <div className="stack">
      <div className="form-grid">
        <Field label={t("wizard.quantity")}>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={spec.quantity}
            onChange={(e) => {
              const quantity = Number(e.target.value);
              update({ quantity, gpuCount: quantity * spec.gpuPerInstance });
            }}
          />
        </Field>
        <SpecNumber
          name="autoShutdownIdleMin"
          label={t("wizard.idle")}
          max={120}
        />
      </div>
      <Review />
    </div>
  );
}
export default function ServerWizard() {
  return (
    <WizardLayout
      kind="gpu_vm"
      steps={[
        "projectRegion",
        "serverSpec",
        "imageStorage",
        "networkSecurity",
        "advancedConfirm",
      ]}
      validateStep={validate}
      firstStepContent={<ScalingToggle kind="gpu_vm" />}
      render={(ctx) => <ServerForm {...ctx} />}
    />
  );
}
