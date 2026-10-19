import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InferenceSpec } from "../../types/domain";
import { t } from "../../i18n";
import { post, EP } from "../../lib/api-client";
import { Field } from "../../components/ui";
import { inferenceSchema } from "../../lib/schema";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec,
  SpecNumber,
  SpecText,
  SpecCheck,
  SpecSelect,
  Review,
  ScalingToggle,
  type FormContext,
  type WizardValues,
} from "./shared/fields";
function validate(v: WizardValues, step: number) {
  const s = v.spec as InferenceSpec;
  if (step === 1)
    return !!s.modelRef && s.maxModelLen >= 4096 && s.maxModelLen <= 1048576;
  if (step === 2)
    return (
      [1, 2, 4, 8].includes(s.gpuPerReplica) &&
      s.replicas >= 1 &&
      s.replicas <= 32
    );
  if (step === 3)
    return (
      s.port >= 1 &&
      s.port <= 65535 &&
      s.maxBatchSize >= 1 &&
      s.maxBatchSize <= 512
    );
  return inferenceSchema.safeParse(s).success;
}
function InferenceForm({ step, pools, models }: FormContext) {
  const { spec, update, form } = useSpec<InferenceSpec>();
  const model = models.find((m) => m.id === spec.modelRef) || models[0];
  const memory = useQuery({
    queryKey: [
      "model-memory",
      spec.modelRef,
      spec.quantization,
      spec.maxModelLen,
    ],
    queryFn: () =>
      post<{ requiredGb: number; weightsGb: number; kvGb: number }>(
        EP.models + "/memory",
        {
          modelRef: spec.modelRef,
          quantization: spec.quantization,
          context: spec.maxModelLen,
        },
      ),
  });
  const pool = pools.find((p) => p.code === form.watch("nodePool"))!;
  const required = memory.data?.requiredGb || 0;
  const capacity = pool.memoryGb * spec.gpuPerReplica;
  const { setError, clearErrors } = form;
  useEffect(() => {
    if (step === 2 && (memory.isPending || required > capacity))
      setError("spec", { type: "memory", message: "MODEL_MEMORY_EXCEEDED" });
    else clearErrors("spec");
  }, [step, memory.isPending, required, capacity, setError, clearErrors]);
  return step === 1 ? (
    <div className="stack">
      <div className="grid grid-2">
        {models.map((m) => (
          <button
            type="button"
            className={`catalog-card ${spec.modelRef === m.id ? "selected" : ""}`}
            key={m.id}
            onClick={() =>
              update({
                modelRef: m.id,
                quantization: m.quantizations[0],
                maxModelLen: Math.min(spec.maxModelLen, m.context),
              })
            }
          >
            <strong>{m.name}</strong>
            <small>
              {m.paramsB}B · {m.license} · {m.modality}
            </small>
          </button>
        ))}
      </div>
      <div className="form-grid">
        <SpecSelect
          name="quantization"
          label={t("wizard.quantization")}
          options={model.quantizations}
        />
        <SpecNumber
          name="maxModelLen"
          label={t("wizard.context")}
          min={4096}
          max={model.context}
        />
      </div>
      <div className="notice">
        {t("wizard.memoryRequired", {
          required: required.toFixed(1),
          capacity,
        })}
      </div>
    </div>
  ) : step === 2 ? (
    <div className="stack">
      <PoolCards
        kind="inference"
        pools={pools.map((p) => ({
          ...p,
          available: p.available && p.memoryGb * 8 >= required,
        }))}
        selected={form.watch("nodePool")}
        onSelect={(p) => form.setValue("nodePool", p.code)}
      />
      <div className="form-grid">
        <Field label={t("resource.replicas") + " · 1–32"}>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={spec.replicas}
            onChange={(e) => {
              const replicas = Number(e.target.value);
              update({ replicas, gpuCount: replicas * spec.gpuPerReplica });
            }}
          />
        </Field>
        <Field label={t("resource.gpu")}>
          <select
            value={spec.gpuPerReplica}
            onChange={(e) => {
              const gpuPerReplica = Number(e.target.value);
              update({
                gpuPerReplica,
                gpuCount: gpuPerReplica * spec.replicas,
              });
            }}
          >
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n} disabled={pool.memoryGb * n < required}>
                {n} GPU
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className={required > capacity ? "field-error" : "notice"}>
        {required > capacity
          ? t("wizard.memoryError")
          : t("wizard.memoryRequired", {
              required: required.toFixed(1),
              capacity,
            })}
      </p>
      <ScalingToggle kind="inference" />
    </div>
  ) : step === 3 ? (
    <div className="stack">
      <div className="form-grid">
        <SpecSelect
          name="engine"
          label={t("resource.engine")}
          options={["vllm", "sglang", "trt-llm"]}
        />
        <SpecNumber name="port" label="Port · 1–65535" min={1} max={65535} />
        <SpecNumber
          name="maxBatchSize"
          label="Batch · 1–512"
          min={1}
          max={512}
        />
        <SpecCheck name="authEnabled" label={t("wizard.auth")} />
        <SpecCheck name="prefixCaching" label={t("wizard.prefixCaching")} />
        <SpecCheck name="chunkedPrefill" label={t("wizard.chunkedPrefill")} />
      </div>
    </div>
  ) : (
    <div className="stack">
      <SpecNumber
        name="canaryPercent"
        label={t("wizard.canary")}
        min={0}
        max={99}
      />
      <SpecCheck name="coldStandby" label="Cold standby" />
      <SpecText name="warmupPrompt" label={t("wizard.warmup")} area />
      <Review />
    </div>
  );
}
export default function InferenceWizard() {
  return (
    <WizardLayout
      kind="inference"
      steps={[
        "projectRegion",
        "modelSelection",
        "deployConfig",
        "serviceConfig",
        "advancedConfirm",
      ]}
      validateStep={validate}
      render={(ctx) => <InferenceForm {...ctx} />}
    />
  );
}
