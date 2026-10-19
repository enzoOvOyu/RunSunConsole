import { z } from "zod";
import type { ServerSpec } from "../../types/domain";
import { t } from "../../i18n";
import { Field } from "../../components/ui";
import { serverSchema } from "../../lib/schema";
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
        vcpu: z.number().positive(),
        memoryGb: z.number().positive(),
      })
      .safeParse(s).success;
  if (step === 2)
    return z
      .object({
        imageRef: z.string().min(1),
        systemDiskGb: z.number().min(40).max(2048),
        dataDiskGb: z.number().min(0).max(32768),
      })
      .safeParse(s).success;
  if (step === 3)
    return (
      (s.authMethod === "password"
        ? z.string().min(8).max(128).safeParse(v.password).success
        : z
            .string()
            .regex(/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]+/)
            .safeParse(s.sshPubkey).success) &&
      s.bandwidthMbps >= 1 &&
      s.bandwidthMbps <= 1000
    );
  return serverSchema.safeParse(s).success;
}
function ServerForm({ step, pools, images }: FormContext) {
  const { spec, update, form } = useSpec<ServerSpec>();
  const selected = form.watch("nodePool");
  return step === 1 ? (
    <div className="stack">
      <PoolCards
        kind="gpu_vm"
        pools={pools}
        selected={selected}
        onSelect={(p) => {
          form.setValue("nodePool", p.code);
          update({
            gpuModel: p.gpuModel,
            gpuCount: spec.gpuPerInstance * spec.quantity,
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
                vcpu: n * 16,
                memoryGb: n * 128,
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
        <SpecNumber name="vcpu" label="vCPU" min={16} max={1024} />
        <SpecNumber
          name="memoryGb"
          label={t("resource.cpu") + " · GB"}
          min={128}
          max={8192}
        />
        <small className="mono">
          gpu.{spec.gpuPerInstance}x{selected.toLowerCase()}.{spec.vcpu}c.
          {spec.memoryGb}g
        </small>
      </div>
    </div>
  ) : step === 2 ? (
    <div className="stack">
      <ImageCards images={images} />
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
        <Field label={t("wizard.password")} hint="8–128">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
          />
        </Field>
      ) : (
        <SpecText name="sshPubkey" label={t("wizard.sshKey")} area />
      )}
      <SpecNumber
        name="bandwidthMbps"
        label={t("wizard.bandwidth")}
        min={1}
        max={1000}
      />
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
        <SpecText name="entrypoint" label="Entrypoint" />
        <Field label={t("wizard.env")}>
          <textarea
            value={Object.entries(spec.env || {})
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")}
            onChange={(e) =>
              update({
                env: Object.fromEntries(
                  e.target.value
                    .split("\n")
                    .filter((x) => x.includes("="))
                    .map((x) => [
                      x.slice(0, x.indexOf("=")),
                      x.slice(x.indexOf("=") + 1),
                    ]),
                ),
              })
            }
          />
        </Field>
        <Field label={t("wizard.ports")}>
          <input
            className="input"
            value={spec.ports?.join(",") || ""}
            onChange={(e) =>
              update({
                ports: e.target.value
                  .split(",")
                  .map(Number)
                  .filter(Number.isFinite),
              })
            }
          />
        </Field>
        <SpecCheck name="publicIp" label={t("wizard.publicIp")} />
      </div>
      <ScalingToggle kind="gpu_vm" />
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
      render={(ctx) => <ServerForm {...ctx} />}
    />
  );
}
