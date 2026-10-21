import { useEffect } from "react";
import { gpuModelDisplayName } from "../../lib/gpu-labels";
import {
  imageSupportsArchitecture,
  imageSupportsPool,
} from "./shared/image-compat";
import { StorageRows } from "./shared/StorageRows";
import { z } from "zod";
import type { BaremetalSpec } from "../../types/domain";
import { t } from "../../i18n";
import { Field } from "../../components/ui";
import { baremetalSchema } from "../../lib/schema";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec,
  SpecNumber,
  SpecText,
  SpecCheck,
  SpecSelect,
  ImageCards,
  NetworkFields,
  Review,
  ScalingToggle,
  type FormContext,
  type WizardValues,
} from "./shared/fields";
function validate(v: WizardValues, step: number) {
  const s = v.spec as BaremetalSpec;
  if (step === 1) return !!s.machineType;
  if (step === 2)
    return z
      .object({
        machineCount: z.number().int().min(1).max(32),
        raidLevel: z.enum(["none", "raid0", "raid1", "raid10"]),
      })
      .safeParse(s).success;
  if (step === 3)
    return !!s.vpc && !!s.subnet && (s.securityGroups?.length || 0) > 0;
  return baremetalSchema.safeParse(s).success;
}
function BaremetalForm({ step, pools, images }: FormContext) {
  const { spec, update, form } = useSpec<BaremetalSpec>();
  const selected = form.watch("nodePool");
  const pool = pools.find((p) => p.code === selected)!;
  useEffect(() => {
    if (!pool.migPreconfigured && !spec.passthrough)
      update({ passthrough: true });
  }, [pool.migPreconfigured, spec.passthrough, update]);
  return step === 1 ? (
    <PoolCards
      kind="gpu_baremetal"
      pools={pools}
      selected={selected}
      onSelect={(p) => {
        form.setValue("nodePool", p.code);
        const currentImage = images.find((image) => image.id === spec.imageRef);
        const compatible = (image: (typeof images)[number]) =>
          image.type === "os" &&
          imageSupportsPool(image, p.code) &&
          imageSupportsArchitecture(image, p.cpuArchitecture);
        const nextImage =
          currentImage && compatible(currentImage)
            ? currentImage
            : images.find(compatible);
        update({
          machineType: p.code,
          imageRef: nextImage?.id || "",
          gpuModel: gpuModelDisplayName(p.gpuModel),
          gpuCount: p.gpusPerNode * spec.machineCount,
          cpuModel: p.cpu,
          memoryGb: p.memorySystemGb,
          localNvmeGb: p.localNvmeGb,
          migPartition: p.migProfile,
        });
      }}
    />
  ) : step === 2 ? (
    <div className="stack">
      <Field
        label={t("wizard.machines")}
        hint={t("wizard.machineHint", { count: pool.gpusPerNode })}
      >
        <input
          className="input"
          type="number"
          min={1}
          max={32}
          value={spec.machineCount}
          onChange={(e) => {
            const count = Number(e.target.value);
            update({ machineCount: count, gpuCount: count * pool.gpusPerNode });
          }}
        />
      </Field>
      {pool.migPreconfigured ? (
        <SpecCheck name="passthrough" label={t("wizard.passthrough")} />
      ) : (
        <Field label={t("wizard.passthrough")}>
          <input
            className="input"
            value={t("baremetal.fullGpuDefault")}
            readOnly
          />
        </Field>
      )}
      {pool.migPreconfigured && !spec.passthrough && (
        <SpecSelect
          name="migPartition"
          label="MIG"
          options={pool.migProfiles || [pool.migProfile]}
        />
      )}
      <SpecSelect
        name="raidLevel"
        label="RAID"
        options={["none", "raid0", "raid1", "raid10"]}
      />
    </div>
  ) : step === 3 ? (
    <div className="stack">
      <NetworkFields dedicatedBaremetal />
    </div>
  ) : (
    <div className="stack">
      <ImageCards
        images={images}
        os
        architecture={pool.cpuArchitecture}
        gpuModel={pool.code}
      />
      <Field label={t("wizard.hostname")} hint={t("wizard.hostnameHint")}>
        <input
          className="input"
          value={spec.hostnamePrefix}
          aria-invalid={
            !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
              spec.hostnamePrefix.trim(),
            ) || spec.hostnamePrefix.trim().length > 45
          }
          onChange={(event) => update({ hostnamePrefix: event.target.value })}
        />
        {(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
          spec.hostnamePrefix.trim(),
        ) ||
          spec.hostnamePrefix.trim().length > 45) && (
          <small className="field-error">{t("wizard.hostnameInvalid")}</small>
        )}
      </Field>
      <SpecText name="sshPubkey" label={t("wizard.sshKey")} area />
      <SpecSelect
        name="firmwareBaseline"
        label={t("wizard.firmware")}
        options={["recommended", "latest"]}
      />
      <SpecNumber
        name="baseStorageGb"
        label={t("quota.storage")}
        min={0}
        max={32768}
      />
      <StorageRows />
      <ScalingToggle kind="gpu_baremetal" />
      <Review />
    </div>
  );
}
export default function BaremetalWizard() {
  return (
    <WizardLayout
      kind="gpu_baremetal"
      steps={[
        "projectRegion",
        "machineSpec",
        "machinePolicy",
        "networkOob",
        "osConfirm",
      ]}
      validateStep={validate}
      render={(ctx) => <BaremetalForm {...ctx} />}
    />
  );
}
