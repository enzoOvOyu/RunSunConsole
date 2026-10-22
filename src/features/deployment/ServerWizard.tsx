import { StorageRows } from "./shared/StorageRows";
import { gpuModelDisplayName } from "../../lib/gpu-labels";
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
function validate(v: WizardValues, step: number) {
  const s = v.spec as ServerSpec;
  if (step === 1)
    return z
      .object({
        gpuPerInstance: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(4),
          z.literal(8),
        ]),
        vcpu: z.number().int().min(8).max(96).multipleOf(8),
        memoryGb: z.number().int(),
      })
      .refine((value) => value.memoryGb === value.vcpu * 2)
      .safeParse(s).success;
  if (step === 2)
    return (
      z
        .object({
          imageRef: z.string().min(1),
          systemDiskGb: z.number().min(40).max(2048),
          dataDiskGb: z.number().min(0).max(32768),
        })
        .safeParse(s).success &&
      storageSelectionsSchema.safeParse(s.storageSelections || []).success
    );
  if (step === 3)
    return (
      (s.authMethod === "password"
        ? z.string().min(8).max(128).safeParse(v.password).success
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
function ServerForm({ step, pools, images }: FormContext) {
  const { spec, update, form } = useSpec<ServerSpec>();
  const selected = form.watch("nodePool");
  const selectedPool = pools.find((pool) => pool.code === selected);
  const password = form.watch("password") || "";
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
            {[1, 2, 4, 8].map((n) => (
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
              update({ vcpu, memoryGb: vcpu * 2 });
            }}
          >
            {Array.from({ length: 12 }, (_, index) => (index + 1) * 8).map(
              (vcpu) => (
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
            value={spec.vcpu * 2}
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
      <ImageCards
        images={images}
        runtime
        architecture={selectedPool?.cpuArchitecture}
        gpuModel={selectedPool?.code}
        osFamily={
          images.find((image) => image.id === spec.imageRef)
            ? imageOsFamily(images.find((image) => image.id === spec.imageRef)!)
            : undefined
        }
      />
      <div className="form-grid">
        <SpecNumber
          name="systemDiskGb"
          label={t("wizard.systemDisk")}
          min={40}
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
      <SpecSelect
        name="authMethod"
        label={t("field.authMethod")}
        options={[
          { value: "ssh_key", label: t("wizard.sshKey") },
          { value: "password", label: t("wizard.password") },
        ]}
      />
      {spec.authMethod === "password" ? (
        <Field label={t("wizard.password")} hint={t("wizard.passwordRule")}>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            aria-invalid={password.length < 8 || password.length > 128}
            {...form.register("password")}
          />
          {(password.length < 8 || password.length > 128) && (
            <small className="field-error">
              {t("wizard.passwordRequired")}
            </small>
          )}
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
