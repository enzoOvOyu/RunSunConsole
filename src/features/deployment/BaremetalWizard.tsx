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
  if (step === 3) return !!s.vpc && s.subnet.startsWith(v.region);
  return baremetalSchema.safeParse(s).success;
}
function BaremetalForm({ step, pools, images }: FormContext) {
  const { spec, update, form } = useSpec<BaremetalSpec>();
  const selected = form.watch("nodePool");
  const pool = pools.find((p) => p.code === selected)!;
  return step === 1 ? (
    <PoolCards
      kind="gpu_baremetal"
      pools={pools}
      selected={selected}
      onSelect={(p) => {
        form.setValue("nodePool", p.code);
        update({
          machineType: p.code,
          gpuModel: p.gpuModel,
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
      <SpecCheck name="passthrough" label={t("wizard.passthrough")} />
      {!spec.passthrough && (
        <SpecSelect
          name="migPartition"
          label="MIG"
          options={[pool.migProfile]}
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
      <NetworkFields />
      <SpecCheck name="ibEnabled" label={"InfiniBand · " + pool.network} />
      <SpecCheck name="ipmiEnabled" label="IPMI / BMC" />
      {spec.ipmiEnabled && (
        <SpecSelect
          name="bmcNetwork"
          label="BMC Network"
          options={["shared", "dedicated"]}
        />
      )}
    </div>
  ) : (
    <div className="stack">
      <ImageCards images={images} os />
      <SpecText name="hostnamePrefix" label={t("wizard.hostname")} />
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
