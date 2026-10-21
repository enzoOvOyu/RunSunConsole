import { StorageRows } from "./shared/StorageRows";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InferenceSpec } from "../../types/domain";
import { t } from "../../i18n";
import { post, EP } from "../../lib/api-client";
import { Field } from "../../components/ui";
import { inferenceSchema, storageSelectionsSchema } from "../../lib/schema";
import {
  compatiblePrecisions,
  precisionLabel,
} from "../../lib/inference-precision";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec,
  NetworkFields,
  SpecNumber,
  SpecText,
  SpecCheck,
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
      s.maxBatchSize <= 512 &&
      storageSelectionsSchema.safeParse(s.storageSelections || []).success
    );
  return inferenceSchema.safeParse(s).success;
}
function InferenceForm({ step, pools, models }: FormContext) {
  const { spec, update, form } = useSpec<InferenceSpec>();
  const textModels = useMemo(
    () => models.filter((item) => item.modality === "text"),
    [models],
  );
  const selectedModel = textModels.find((item) => item.id === spec.modelRef);
  const model = selectedModel;
  const selectedPool = form.watch("nodePool");
  const pool = pools.find((item) => item.code === selectedPool) || pools[0];
  const precisions = useMemo(
    () =>
      model
        ? model.quantizations.filter((precision) =>
            pools.some(
              (item) =>
                item.available &&
                compatiblePrecisions(model, item.code, spec.engine).includes(
                  precision,
                ),
            ),
          )
        : [],
    [model, pools, spec.engine],
  );
  const selectedPoolPrecisions = useMemo(
    () =>
      model && pool?.available
        ? compatiblePrecisions(model, pool.code, spec.engine)
        : [],
    [model, pool, spec.engine],
  );
  const [autoNotice, setAutoNotice] = useState("");
  const memory = useQuery({
    queryKey: [
      "model-memory",
      model?.id,
      spec.engine,
      selectedPool,
      spec.quantization,
      spec.gpuPerReplica,
      spec.maxModelLen,
    ],
    enabled:
      step === 2 &&
      !!selectedModel &&
      selectedPoolPrecisions.includes(spec.quantization),
    queryFn: () =>
      post<{ requiredGb: number; weightsGb: number; kvGb: number }>(
        EP.models + "/memory",
        {
          modelRef: selectedModel!.id,
          quantization: spec.quantization,
          context: spec.maxModelLen,
        },
      ),
  });
  const required = memory.data?.requiredGb;
  const capacity = (pool?.memoryGb || 0) * spec.gpuPerReplica;
  const precisionOptions = (
    nextModel: (typeof textModels)[number],
    nextEngine = spec.engine,
    nextPool?: string,
  ) =>
    nextPool
      ? compatiblePrecisions(
          nextModel,
          nextPool as typeof selectedPool,
          nextEngine,
        )
      : nextModel.quantizations.filter((precision) =>
          pools.some(
            (item) =>
              item.available &&
              compatiblePrecisions(nextModel, item.code, nextEngine).includes(
                precision,
              ),
          ),
        );
  const setDependencies = (
    patch: Partial<InferenceSpec>,
    nextModel = model,
    nextPool: string | undefined = undefined,
    nextEngine = spec.engine,
  ) => {
    if (!nextModel) return;
    const available = precisionOptions(nextModel, nextEngine, nextPool);
    const requestedPrecision = patch.quantization || spec.quantization;
    const nextPrecision = available.includes(requestedPrecision)
      ? requestedPrecision
      : available[0];
    const changedPrecision =
      !!nextPrecision && nextPrecision !== spec.quantization;
    const nextContext = patch.maxModelLen ?? spec.maxModelLen;
    const changedContext = nextContext !== spec.maxModelLen;
    update({
      ...patch,
      ...(nextPrecision ? { quantization: nextPrecision } : {}),
    });
    setAutoNotice(
      [
        changedPrecision
          ? t("wizard.precisionAutoChanged", {
              previous: spec.quantization.toUpperCase(),
              next: nextPrecision ? nextPrecision.toUpperCase() : "—",
            })
          : "",
        changedContext
          ? t("wizard.contextAutoChanged", {
              previous: spec.maxModelLen,
              next: nextContext,
            })
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };
  useEffect(() => {
    const activePrecisions = step === 2 ? selectedPoolPrecisions : precisions;
    if (
      model &&
      activePrecisions.length &&
      !activePrecisions.includes(spec.quantization)
    ) {
      const nextPrecision = activePrecisions[0];
      update({ quantization: nextPrecision });
      setAutoNotice(
        t("wizard.precisionAutoChanged", {
          previous: spec.quantization.toUpperCase(),
          next: nextPrecision.toUpperCase(),
        }),
      );
    }
  }, [
    model,
    precisions,
    selectedPoolPrecisions,
    selectedPool,
    spec.engine,
    spec.quantization,
    step,
    update,
  ]);
  const { setError, clearErrors } = form;
  useEffect(() => {
    if (
      (step === 1 && selectedModel && !precisions.length) ||
      (step === 2 && selectedModel && !selectedPoolPrecisions.length)
    ) {
      setError("spec", {
        type: "precision",
        message: "INFERENCE_PRECISION_UNAVAILABLE",
      });
    } else if (
      step === 2 &&
      (!selectedModel ||
        !selectedPoolPrecisions.includes(spec.quantization) ||
        !required ||
        required > capacity ||
        memory.isError)
    ) {
      setError("spec", {
        type: "memory",
        message: !selectedModel
          ? "MODEL_MODALITY_UNSUPPORTED"
          : !selectedPoolPrecisions.includes(spec.quantization)
            ? "INFERENCE_PRECISION_UNAVAILABLE"
            : memory.isError
              ? "MODEL_MEMORY_CHECK_FAILED"
              : "MODEL_MEMORY_EXCEEDED",
      });
    } else clearErrors("spec");
  }, [
    step,
    selectedModel,
    precisions,
    selectedPoolPrecisions,
    spec.quantization,
    required,
    capacity,
    memory.isError,
    setError,
    clearErrors,
  ]);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof textModels>();
    for (const item of textModels) {
      const publisher = item.publisher || t("images.unknownPublisher");
      groups.set(publisher, [...(groups.get(publisher) || []), item]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [textModels]);

  return step === 1 ? (
    <div className="stack">
      <section className="stack">
        <strong>{t("wizard.inferenceConfigGroup")}</strong>
        <p className="muted">{t("wizard.textModelsOnly")}</p>
        <div className="inference-model-groups">
          {modelGroups.map(([publisher, items]) => (
            <details
              key={publisher}
              name="inference-model-publishers"
              open={items.some((item) => item.id === spec.modelRef)}
              className="panel inference-model-group"
            >
              <summary className="between">
                <strong>{publisher}</strong>
                <span className="muted">
                  {items.length} ·{" "}
                  {items.some((item) => item.id === spec.modelRef)
                    ? model?.name
                    : ""}
                </span>
              </summary>
              <Field label={t("wizard.selectModel")}>
                <select
                  value={
                    items.some((item) => item.id === spec.modelRef)
                      ? spec.modelRef
                      : ""
                  }
                  onChange={(event) => {
                    const nextModel = items.find(
                      (item) => item.id === event.target.value,
                    );
                    if (nextModel)
                      setDependencies(
                        {
                          modelRef: nextModel.id,
                          maxModelLen: Math.min(
                            spec.maxModelLen,
                            nextModel.context,
                          ),
                        },
                        nextModel,
                        undefined,
                      );
                  }}
                >
                  <option value="">{t("wizard.selectModel")}</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.paramsB}B
                    </option>
                  ))}
                </select>
              </Field>
            </details>
          ))}
        </div>
        {!selectedModel && (
          <p className="field-error">{t("wizard.textModelRequired")}</p>
        )}
        {model && (
          <div className="form-grid">
            <Field label={t("resource.engine")}>
              <select
                value={spec.engine}
                onChange={(event) =>
                  setDependencies({}, model, undefined, event.target.value)
                }
              >
                {["vllm", "sglang", "trt-llm"].map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("resource.gpu")}>
              <select
                value={spec.gpuPerReplica}
                onChange={(event) =>
                  update({
                    gpuPerReplica: Number(event.target.value),
                    gpuCount: Number(event.target.value) * spec.replicas,
                  })
                }
              >
                {[1, 2, 4, 8].map((count) => (
                  <option key={count} value={count}>
                    {count} GPU
                  </option>
                ))}
              </select>
            </Field>
            <SpecNumber
              name="maxModelLen"
              label={t("wizard.context")}
              min={4096}
              max={model.context}
            />
          </div>
        )}
        {!precisions.length && model && (
          <p className="field-error">{t("wizard.noCompatiblePrecision")}</p>
        )}
        {autoNotice && <p className="notice">{autoNotice}</p>}
      </section>
    </div>
  ) : step === 2 ? (
    <div className="stack">
      <strong>{t("wizard.gpuPool")}</strong>
      <PoolCards
        kind="inference"
        pools={pools.map((item) => ({
          ...item,
          available:
            item.available &&
            !!model &&
            compatiblePrecisions(model, item.code, spec.engine).length > 0,
        }))}
        selected={selectedPool}
        onSelect={(item) => {
          form.setValue("nodePool", item.code, { shouldDirty: true });
          if (model) setDependencies({}, model, item.code);
        }}
      />
      <Field label={t("wizard.quantization")}>
        <select
          value={
            selectedPoolPrecisions.includes(spec.quantization)
              ? spec.quantization
              : ""
          }
          disabled={!selectedPoolPrecisions.length}
          onChange={(event) => {
            if (event.target.value)
              update({ quantization: event.target.value });
            setAutoNotice("");
          }}
        >
          <option value="" disabled>
            {t(
              selectedPoolPrecisions.length
                ? "wizard.selectPrecision"
                : "wizard.noCompatiblePrecision",
            )}
          </option>
          {selectedPoolPrecisions.map((precision) => (
            <option key={precision} value={precision}>
              {precisionLabel(precision)}
            </option>
          ))}
        </select>
      </Field>
      {!selectedPoolPrecisions.length && model && (
        <p className="field-error">{t("wizard.noCompatiblePrecision")}</p>
      )}
      <p className="notice">{t("wizard.precisionHint")}</p>
      {autoNotice && <p className="notice">{autoNotice}</p>}
      <div className="form-grid">
        <Field label={t("resource.gpu")}>
          <select
            value={spec.gpuPerReplica}
            onChange={(event) => {
              const gpuPerReplica = Number(event.target.value);
              update({
                gpuPerReplica,
                gpuCount: gpuPerReplica * spec.replicas,
              });
            }}
          >
            {[1, 2, 4, 8].map((count) => (
              <option key={count} value={count}>
                {count} GPU
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("resource.replicas") + " · 1–32"}>
          <input
            className="input"
            type="number"
            min={1}
            max={32}
            value={spec.replicas}
            onChange={(event) => {
              const replicas = Number(event.target.value);
              update({ replicas, gpuCount: replicas * spec.gpuPerReplica });
            }}
          />
        </Field>
      </div>
      <p className="notice">
        {t("wizard.gpuPerReplicaSummary", { count: spec.gpuPerReplica })}
      </p>
      {memory.isError ? (
        <p className="field-error">{t("wizard.memoryCheckFailed")}</p>
      ) : !selectedModel ? (
        <p className="field-error">{t("wizard.textModelRequired")}</p>
      ) : required === undefined ? (
        <p className="notice">{t("wizard.memoryChecking")}</p>
      ) : (
        <div
          className={`inference-memory-card ${required > capacity ? "insufficient" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="between">
            <span>{t("wizard.memoryNeededLabel")}</span>
            <strong>{required.toFixed(1)} GB</strong>
          </div>
          <div className="inference-memory-track" aria-hidden="true">
            <span
              className="inference-memory-fill"
              style={{
                width: `${Math.min(100, (capacity / Math.max(required, 0.1)) * 100)}%`,
              }}
            />
          </div>
          <div className="between">
            <span>
              {t("wizard.memoryAvailableLabel", {
                gpu: spec.gpuPerReplica,
              })}
            </span>
            <strong>{capacity.toLocaleString()} GB</strong>
          </div>
          {required > capacity ? (
            <p className="field-error">
              {t("wizard.memoryShortfall", {
                required: required.toFixed(1),
                capacity,
                shortfall: (required - capacity).toFixed(1),
              })}
            </p>
          ) : (
            <small className="muted">
              {t("wizard.memoryRequired", {
                required: required.toFixed(1),
                capacity,
              })}
            </small>
          )}
        </div>
      )}
      <ScalingToggle kind="inference" />
    </div>
  ) : step === 3 ? (
    <div className="stack">
      <NetworkFields />
      <div className="form-grid">
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
      <StorageRows />
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
