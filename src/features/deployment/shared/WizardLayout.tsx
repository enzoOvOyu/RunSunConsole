import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { useNavigate, useSearchParams, useBlocker } from "react-router-dom";
import { z } from "zod";
import {
  REGIONS,
  type Kind,
  type Pool,
  type Project,
  type Image,
  type Model,
  type Resource,
  type PriceEstimate,
} from "../../../types/domain";
import { defaultSpec } from "../../../lib/config";
import { orderSchema } from "../../../lib/schema";
import { KIND_META, resourceLink } from "../../../lib/ids";
import { clientUuid } from "../../../lib/uuid";
import { EP, post, query } from "../../../lib/api-client";
import { useRegion } from "../../../stores/region";
import { useAuth } from "../../../stores/auth";
import { canWrite } from "../../../lib/rbac";
import { t } from "../../../i18n";
import { money, unitMoney } from "../../../lib/money";
import { gpuModelDisplayName } from "../../../lib/gpu-labels";
import {
  Button,
  PageHeader,
  Panel,
  Modal,
  Field,
  Loading,
  ErrorState,
  toast,
  KeyValues,
} from "../../../components/ui";
import { useAction, useData } from "../../shared/hooks";
import { ProjectSelect, type WizardValues, type FormContext } from "./fields";
function normalizeServerCompute(spec: Resource["spec"]): Resource["spec"] {
  if (!("gpuPerInstance" in spec)) return spec;
  const rawVcpu = Number(spec.vcpu) || 16;
  const vcpu = Math.max(8, Math.min(96, Math.round(rawVcpu / 8) * 8));
  return { ...spec, vcpu, memoryGb: vcpu * 2 };
}
interface Props {
  kind: Kind;
  steps: string[];
  render: (context: FormContext) => React.ReactNode;
  validateStep: (values: WizardValues, step: number) => boolean;
}
export function PoolCards({
  pools,
  kind,
  onSelect,
  selected,
}: {
  pools: Pool[];
  kind: Kind;
  onSelect: (pool: Pool) => void;
  selected: string;
}) {
  const region = useRegion((s) => s.region);
  const rates = useData<
    {
      region: string;
      pool: string;
      kind: string;
      unit: string;
      unitPrice: number;
    }[]
  >(["rates", region], EP.rates + query({ region }));
  return (
    <div className="grid grid-2">
      {pools.map((pool) => {
        const rate = rates.data?.find(
          (r) =>
            r.kind === kind &&
            r.pool === pool.code &&
            r.unit ===
              (kind === "gpu_baremetal" ? "per_machine_hour" : "per_gpu_hour"),
        );
        return (
          <button
            type="button"
            key={pool.code}
            disabled={!pool.available}
            onClick={() => onSelect(pool)}
            className={`catalog-card ${selected === pool.code ? "selected" : ""}`}
          >
            <strong>{gpuModelDisplayName(pool.gpuModel)}</strong>
            <small>
              {kind === "gpu_baremetal"
                ? t("wizard.machineHint", { count: pool.gpusPerNode })
                : `${pool.memoryGb} GB HBM · ${pool.bandwidthGbs} GB/s`}
            </small>
            {kind === "gpu_baremetal" && (
              <small>
                {pool.cpu} · {pool.memorySystemGb} GB ·{" "}
                {pool.localNvmeGb / 1000} TB NVMe · {pool.network}
              </small>
            )}
            <div className="price">
              {rate ? unitMoney(rate.unitPrice) : "—"}{" "}
              <small>
                /{" "}
                {t(
                  kind === "gpu_baremetal"
                    ? "unit.per_machine_hour"
                    : "unit.per_gpu_hour",
                )}
              </small>
            </div>
            <small>
              {pool.available
                ? t("wizard.available", { count: pool.availableGpu })
                : t("wizard.unavailable")}
            </small>
          </button>
        );
      })}
    </div>
  );
}
export function WizardLayout({ kind, steps, render, validateStep }: Props) {
  const [params] = useSearchParams();
  const { region, setRegion } = useRegion();
  const { role, project, setProject } = useAuth();
  const pools = useData<Pool[]>(
    ["pools", region],
    EP.pools + query({ region }),
  );
  const projects = useData<Project[]>(["projects"], EP.projects);
  const images = useData<Image[]>(["images"], EP.images);
  const models = useData<Model[]>(["models"], EP.models);
  const clone = useData<Resource>(
    ["clone", params.get("clone")],
    `${EP.resources}/${params.get("clone")}`,
    { enabled: !!params.get("clone") },
  );
  if (
    pools.isPending ||
    projects.isPending ||
    images.isPending ||
    models.isPending ||
    (params.get("clone") && clone.isPending)
  )
    return <Loading />;
  if (pools.error || projects.error || images.error || models.error)
    return (
      <ErrorState
        error={pools.error || projects.error || images.error || models.error}
      />
    );
  return (
    <WizardForm
      key={kind}
      kind={kind}
      steps={steps}
      render={render}
      validateStep={validateStep}
      context={{
        kind,
        step: 0,
        pools: pools.data!,
        projects: projects.data!,
        images: images.data!,
        models: models.data!,
      }}
      region={region}
      setRegion={setRegion}
      project={project}
      setProject={setProject}
      writable={canWrite(role)}
      clone={clone.data}
      source={Object.fromEntries(params)}
    />
  );
}
function WizardForm({
  kind,
  steps,
  render,
  validateStep,
  context,
  region,
  setRegion,
  project,
  setProject,
  writable,
  clone,
  source,
}: {
  kind: Kind;
  steps: string[];
  render: Props["render"];
  validateStep: Props["validateStep"];
  context: FormContext;
  region: WizardValues["region"];
  setRegion: (region: WizardValues["region"]) => void;
  project: string;
  setProject: (id: string) => void;
  writable: boolean;
  clone?: Resource;
  source: Record<string, string>;
}) {
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [newProject, setNewProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [apiKey, setApiKey] = useState("");
  const [created, setCreated] = useState<Resource | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);
  const idempotency = useRef(
    sessionStorage.getItem(`wizard:key:${kind}`) || clientUuid(),
  );
  useEffect(() => {
    sessionStorage.setItem(`wizard:key:${kind}`, idempotency.current);
  }, [kind]);
  const { run, busy } = useAction();
  const navigate = useNavigate();
  const pool = context.pools.find((p) => p.available)!;
  const initial = (): WizardValues => {
    const base: WizardValues = {
      projectId: project || context.projects[0]?.id || "",
      region,
      name: `${KIND_META[kind].prefix}new`,
      nodePool: pool.code,
      mode: "on_demand",
      labels: [],
      spec: defaultSpec(kind, pool),
      agree: false,
      password: "",
    };
    try {
      const stored = sessionStorage.getItem(`wizard:${kind}`);
      if (stored && !clone && !source.model) {
        const draft = JSON.parse(stored) as WizardValues;
        if (kind === "gpu_vm") draft.spec = normalizeServerCompute(draft.spec);
        return draft;
      }
    } catch {
      /* Start a fresh form when a stored draft is invalid. */
    }
    if (clone && clone.kind === kind)
      return {
        ...base,
        region: clone.region,
        projectId: clone.projectId,
        name: clone.name + "-copy",
        nodePool: clone.nodePool,
        mode: clone.mode,
        spec:
          kind === "gpu_vm"
            ? normalizeServerCompute(structuredClone(clone.spec))
            : structuredClone(clone.spec),
      };
    if (
      source.model &&
      "modelRef" in base.spec &&
      context.models.some((model) => model.id === source.model)
    )
      base.spec.modelRef = source.model;
    if (source.image && "imageRef" in base.spec) {
      const selectedImage = context.images.find(
        (image) => image.id === source.image,
      );
      if (selectedImage?.type === "container" && "runtimeImageRef" in base.spec)
        base.spec.runtimeImageRef = selectedImage.id;
      else if (selectedImage?.type === "os")
        base.spec.imageRef = selectedImage.id;
    }
    if (source.runtime && "runtimeImageRef" in base.spec)
      base.spec.runtimeImageRef = source.runtime;
    return base;
  };
  const form = useForm<WizardValues>({ defaultValues: initial() });
  const values = form.watch();
  useEffect(() => {
    if (step > furthest) setFurthest(step);
  }, [step, furthest]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !submittedRef.current &&
      form.formState.isDirty &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    const sub = form.watch((value) =>
      sessionStorage.setItem(
        `wizard:${kind}`,
        JSON.stringify({ ...value, password: "" }),
      ),
    );
    return () => sub.unsubscribe();
  }, [form, kind]);
  useEffect(() => {
    if (values.region !== region) setRegion(values.region);
  }, [values.region, region, setRegion]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (form.formState.isDirty && !submitted) e.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [form.formState.isDirty, submitted]);
  const price = useQuery({
    queryKey: [
      "estimate",
      kind,
      values.region,
      values.nodePool,
      values.mode,
      JSON.stringify(values.spec),
    ],
    queryFn: () =>
      post<PriceEstimate>(EP.orders + "/estimate", {
        kind,
        region: values.region,
        nodePool: values.nodePool,
        mode: values.mode,
        spec: values.spec,
      }),
    retry: false,
  });
  const firstValid = z
    .object({
      projectId: z.string().min(1),
      region: z.enum(REGIONS),
      name: z.string().min(3).max(63),
    })
    .safeParse(values).success;
  const currentSize =
    "quantity" in values.spec
      ? values.spec.quantity
      : "machineCount" in values.spec
        ? values.spec.machineCount
        : "nodePools" in values.spec
          ? values.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0)
          : values.spec.replicas;
  const factor = values.spec.scaling
    ? values.spec.scaling.max_size / currentSize
    : 1;
  const requests =
    "nodePools" in values.spec
      ? values.spec.nodePools.map((p) => ({
          pool: p.poolCode,
          gpu: p.nodeCount * p.gpuPerNode * factor,
        }))
      : [{ pool: values.nodePool, gpu: values.spec.gpuCount * factor }];
  const byPool = new Map<string, number>();
  for (const r of requests)
    byPool.set(r.pool, (byPool.get(r.pool) || 0) + r.gpu);
  const overCapacity = [...byPool].some(([code, count]) => {
    const pool = context.pools.find((p) => p.code === code);
    return !pool?.available || count > pool.availableGpu;
  });
  const poolStep = kind === "gpu_vm" || kind === "gpu_baremetal" ? 1 : 2;
  const scalingRangeInvalid =
    !!values.spec.scaling &&
    (values.spec.scaling.min_size > currentSize ||
      values.spec.scaling.max_size < currentSize);
  const valid =
    (step === 0 ? firstValid : validateStep(values, step)) &&
    !(step >= poolStep && overCapacity) &&
    !scalingRangeInvalid &&
    !form.formState.errors.spec;
  const submit = async () => {
    const result = orderSchema.safeParse({ ...values, kind });
    if (!result.success || !values.agree) {
      setError(new Error("VALIDATION_ERROR"));
      return;
    }
    setError(null);
    const response = await run(
      () =>
        post<{ resource: Resource; apiKey: string | null }>(
          EP.orders,
          {
            ...result.data,
            authPassword: values.password,
            sourceType: source.template
              ? "app"
              : source.model
                ? "model"
                : source.image || source.runtime
                  ? "image"
                  : clone
                    ? "clone"
                    : "direct",
            sourceRefId:
              source.template ||
              source.model ||
              source.image ||
              source.runtime ||
              clone?.resourceUuid ||
              "",
          },
          { "Idempotency-Key": idempotency.current },
        ),
      "wizard.created",
    );
    if (response) {
      submittedRef.current = true;
      setSubmitted(true);
      sessionStorage.removeItem(`wizard:${kind}`);
      sessionStorage.removeItem(`wizard:key:${kind}`);
      setProject(values.projectId);
      setCreated(response.resource);
      if (response.apiKey) setApiKey(response.apiKey);
      else navigate(resourceLink(response.resource));
    }
  };
  return (
    <FormProvider {...form}>
      <PageHeader
        title={`${t("common.create")} ${t("common." + kind)}`}
        subtitle={t("wizard.review")}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 4) void submit();
          else if (valid) setStep(step + 1);
        }}
      >
        <div className="wizard">
          <nav className="wizard-steps">
            {steps.map((id, i) => (
              <button
                type="button"
                className={`wizard-step ${i === step ? "current" : ""}`}
                key={id}
                disabled={i > furthest}
                onClick={() => setStep(i)}
              >
                <span className="step-number">{i < step ? "✓" : i + 1}</span>
                {t("wizard." + id)}
              </button>
            ))}
          </nav>
          <div className="wizard-main stack">
            <Panel title={t("wizard." + steps[step])}>
              {step === 0 ? (
                <div className="stack">
                  <Field label={t("common.project")}>
                    <ProjectSelect
                      projects={context.projects}
                      onCreate={() => setNewProject(true)}
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label={t("common.region")}>
                      <select
                        {...form.register("region")}
                        onChange={(e) => {
                          const next = e.target.value as WizardValues["region"];
                          form.setValue("region", next, { shouldDirty: true });
                          const spec = form.getValues("spec");
                          if ("subnet" in spec)
                            form.setValue("spec", {
                              ...spec,
                              subnet: next + "-default",
                            } as Resource["spec"]);
                          setRegion(next);
                        }}
                      >
                        {REGIONS.map((r) => (
                          <option key={r} value={r}>
                            {t("common." + r)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("common.name")} hint={t("wizard.nameHint")}>
                      <input
                        className="input"
                        {...form.register("name")}
                        minLength={3}
                        maxLength={63}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                render({ ...context, step })
              )}
            </Panel>
            {!valid && (
              <div className="field-error">
                {t(
                  step >= poolStep && overCapacity
                    ? "wizard.capacity"
                    : "wizard.invalid",
                )}
              </div>
            )}
            {!!error && <ErrorState error={error} />}
            <div className="between">
              <Button
                disabled={step === 0 || busy}
                onClick={() => setStep(step - 1)}
              >
                {t("common.previous")}
              </Button>
              {step < 4 ? (
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!valid || !writable}
                >
                  {t("common.next")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    busy ||
                    !writable ||
                    !values.agree ||
                    !valid ||
                    price.isError
                  }
                >
                  {t("common.create")}
                </Button>
              )}
            </div>
          </div>
          <div className="cost-summary">
            <Panel title={t("price.breakdown")} className="cost-panel">
              <div className="cost-mode">
                <Field label={t("common.type")}>
                  <select {...form.register("mode")}>
                    {["on_demand", "spot", "reserved"].map((mode) => (
                      <option key={mode} value={mode}>
                        {t("price." + mode)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {values.mode === "spot" && (
                <p className="notice warning cost-warning">
                  {t("price.spotWarning")}
                </p>
              )}
              {price.isPending ? (
                <Loading />
              ) : price.error ? (
                <ErrorState error={price.error} />
              ) : (
                <>
                  <div className="cost-items">
                    {price.data.lines.map((line, i) => (
                      <div className="cost-line" key={i}>
                        <div className="cost-line-detail">
                          <span>{t("price." + line.key.split(":")[0])}</span>
                          {line.key === "control" &&
                            "controlPlaneTier" in values.spec &&
                            values.spec.controlPlaneTier === "ha" && (
                              <small>{t("price.haControlPlaneNote")}</small>
                            )}
                          <small>
                            {line.quantity} × {unitMoney(line.unitPrice)} /{" "}
                            {t("unit." + line.unit)}
                          </small>
                        </div>
                        <strong className="cost-line-amount">
                          {money(line.hourly)}
                          <small>{t("common.perHour")}</small>
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="cost-estimate">
                    <span className="cost-estimate-label">
                      {t("common.hourly")}
                    </span>
                    <div className="cost-total">
                      <span>{money(price.data.hourly)}</span>
                      <small>{t("common.perHour")}</small>
                    </div>
                    <div className="cost-monthly">
                      <span>{t("price.monthly")}</span>
                      <strong>{money(price.data.monthly)}</strong>
                    </div>
                  </div>
                  {values.spec.scaling && (
                    <div className="cost-range">
                      <KeyValues
                        items={[
                          [t("price.floor"), money(price.data.floorMonthly)],
                          [t("price.peak"), money(price.data.peakMonthly)],
                        ]}
                      />
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>
        </div>
      </form>
      <Modal
        open={newProject}
        onClose={() => setNewProject(false)}
        title={t("wizard.projectNew")}
      >
        <div className="stack">
          <Field label={t("project.name")}>
            <input
              className="input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </Field>
          <Button
            disabled={projectName.length < 2 || busy}
            onClick={async () => {
              const p = await run(() =>
                post<Project>(EP.projects, { name: projectName }),
              );
              if (p) {
                form.setValue("projectId", p.id);
                setNewProject(false);
                setProjectName("");
              }
            }}
          >
            {t("common.create")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={blocker.state === "blocked"}
        onClose={() => blocker.state === "blocked" && blocker.reset()}
        title={t("wizard.leave")}
      >
        <div className="dialog-footer">
          <Button
            onClick={() => blocker.state === "blocked" && blocker.reset()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => blocker.state === "blocked" && blocker.proceed()}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!apiKey}
        onClose={() => {
          setApiKey("");
          if (created) navigate(resourceLink(created));
        }}
        title={t("resource.passwordOnce")}
      >
        <pre>{apiKey}</pre>
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(apiKey)
              .then(() => toast(t("common.copied")))
              .catch(() => toast(t("error.INTERNAL"), true));
          }}
        >
          {t("common.copy")}
        </Button>
      </Modal>
    </FormProvider>
  );
}
