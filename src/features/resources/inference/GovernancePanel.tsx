import { useState } from "react";
import { Link } from "react-router-dom";
import type { ResourceOf } from "../../../types/domain";
import type {
  InferenceGovernance,
  InferenceGovernanceSettings,
} from "../../../types/inference";
import { EP, post } from "../../../lib/api-client";
import { inferenceGovernanceSchema } from "../../../lib/schema";
import { canWrite } from "../../../lib/rbac";
import { useAuth } from "../../../stores/auth";
import { t, dt } from "../../../i18n";
import { number } from "../../../lib/money";
import { useData, useAction } from "../../shared/hooks";
import {
  Panel,
  KeyValues,
  DataTable,
  Button,
  CopyButton,
  Badge,
  Field,
  Modal,
  Loading,
  ErrorState,
} from "../../../components/ui";

export function GovernancePanel({
  resource: r,
}: {
  resource: ResourceOf<"inference">;
}) {
  const q = useData<InferenceGovernance>(
    ["inference-governance", r.resourceUuid],
    EP.governance(r.resourceUuid),
    { poll: true },
  );
  const role = useAuth((s) => s.role);
  const { run, busy } = useAction();
  const [draft, setDraft] = useState<InferenceGovernanceSettings | null>(null);
  const [baseline, setBaseline] = useState<InferenceGovernanceSettings | null>(
    null,
  );
  const [review, setReview] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const allowed = canWrite(role) && r.status === "running" && !r.deletedAt;
  if (q.isPending) return <Loading />;
  if (q.error)
    return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const data = q.data;
  const curl = `curl '${data.endpoint}/v1/chat/completions'${data.authEnabled ? ' -H "Authorization: Bearer $RUNSUN_API_KEY"' : ""} -H 'Content-Type: application/json' -d '${JSON.stringify({ model: data.modelRef, messages: [{ role: "user", content: "Hello" }] })}'`;
  const fields = ["canaryPercent", "qpsLimit", "timeoutMs"] as const;
  const units = { canaryPercent: "%", qpsLimit: "req/s", timeoutMs: "ms" };
  const changed =
    !!draft && !!baseline && fields.some((key) => draft[key] !== baseline[key]);
  const close = () => {
    if (!busy) {
      setDraft(null);
      setBaseline(null);
      setReview(false);
      setInvalid(false);
    }
  };
  const open = () => {
    const settings = {
      canaryPercent: data.canaryPercent,
      qpsLimit: data.qpsLimit,
      timeoutMs: data.timeoutMs,
    };
    setBaseline(settings);
    setDraft(settings);
    setReview(false);
    setInvalid(false);
  };
  const save = async () => {
    if (
      !allowed ||
      !draft ||
      !inferenceGovernanceSchema.safeParse(draft).success
    )
      return;
    const result = await run(() => post(EP.governance(r.resourceUuid), draft));
    if (result) {
      setDraft(null);
      setBaseline(null);
      setReview(false);
    }
  };
  return (
    <div className="stack">
      {!data.active && <p className="notice">{t("resource.startToUse")}</p>}
      <Panel title={t("common.endpoint")}>
        <KeyValues
          items={[
            [
              t("common.endpoint"),
              <span className="row">
                <code>{data.endpoint}</code>
                <CopyButton value={data.endpoint} />
              </span>,
            ],
            [t("resource.model"), dt(data.modelName)],
            [
              t("governance.authentication"),
              data.authEnabled
                ? t("governance.apiKey")
                : t("governance.noAuth"),
            ],
          ]}
        />
        {data.authEnabled && (
          <p className="notice section-gap">{t("governance.keyOnce")}</p>
        )}
        <h3>{t("governance.example")}</h3>
        <pre>{curl}</pre>
        <CopyButton value={curl} />
      </Panel>
      <Panel
        title={t("governance.traffic")}
        action={
          <Button disabled={!allowed || busy} onClick={open}>
            {t("governance.edit")}
          </Button>
        }
      >
        <p className="muted">{t("governance.rule")}</p>
        <DataTable
          data={data.versions}
          paginate={false}
          columns={[
            { accessorKey: "version", header: t("governance.version") },
            {
              accessorKey: "id",
              header: t("common.type"),
              cell: ({ row }) => t("governance." + row.original.id),
            },
            { accessorKey: "modelRef", header: t("resource.model") },
            { accessorKey: "engine", header: t("field.engine") },
            {
              accessorKey: "trafficPercent",
              header: t("governance.share"),
              cell: ({ row }) => number(row.original.trafficPercent) + "%",
            },
            {
              id: "status",
              header: t("common.status"),
              cell: ({ row }) => (
                <Badge status={row.original.ready ? "running" : "stopped"} />
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t("governance.gateway")}>
        <KeyValues
          items={[
            [t("governance.qpsLimit"), `${number(data.qpsLimit)} req/s`],
            [t("governance.timeoutMs"), `${number(data.timeoutMs)} ms`],
            [
              t("nav.scaling"),
              data.scalingPolicy ? (
                <span>
                  {t("scaling." + data.scalingPolicy.config.trigger_metric)} ·{" "}
                  {number(data.scalingPolicy.config.target_value)} ·{" "}
                  <Badge status={data.scalingPolicy.status} />
                </span>
              ) : (
                t("common.noData")
              ),
            ],
          ]}
        />
        <p className="notice section-gap">
          {t("resource.scaleReadonly")} ·{" "}
          <Link to="/workbench/scaling">{t("nav.scaling")}</Link>
        </p>
      </Panel>
      <p className="notice">{t("price.inferenceNote")}</p>
      <Modal
        open={!!draft}
        onClose={close}
        title={review ? t("governance.review") : t("governance.edit")}
      >
        {draft && baseline && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!allowed || busy) return;
              if (review) {
                void save();
                return;
              }
              const result = inferenceGovernanceSchema.safeParse(draft);
              setInvalid(!result.success);
              if (result.success && changed) setReview(true);
            }}
          >
            {review ? (
              <>
                <p>{t("governance.confirmNote")}</p>
                <KeyValues
                  items={fields.map((key) => [
                    t("governance." + key),
                    `${number(baseline[key])} ${units[key]} → ${number(draft[key])} ${units[key]}`,
                  ])}
                />
              </>
            ) : (
              <>
                <Field
                  label={t("governance.canaryPercent")}
                  hint={t("governance.canaryHint")}
                >
                  <input
                    className="input"
                    type="number"
                    aria-label={t("governance.canaryPercent")}
                    min={0}
                    max={99}
                    step={1}
                    required
                    disabled={!allowed || busy}
                    value={draft.canaryPercent}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        canaryPercent: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <input
                  type="range"
                  aria-label={t("governance.slider")}
                  min={0}
                  max={99}
                  step={1}
                  disabled={!allowed || busy}
                  value={draft.canaryPercent}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      canaryPercent: Number(e.target.value),
                    })
                  }
                />
                <Field label={t("governance.qpsLimit")} hint="1–100,000 req/s">
                  <input
                    className="input"
                    type="number"
                    aria-label={t("governance.qpsLimit")}
                    min={1}
                    max={100000}
                    step={1}
                    required
                    disabled={!allowed || busy}
                    value={draft.qpsLimit}
                    onChange={(e) =>
                      setDraft({ ...draft, qpsLimit: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field
                  label={t("governance.timeoutMs")}
                  hint="1,000–300,000 ms"
                >
                  <input
                    className="input"
                    type="number"
                    aria-label={t("governance.timeoutMs")}
                    min={1000}
                    max={300000}
                    step={1}
                    required
                    disabled={!allowed || busy}
                    value={draft.timeoutMs}
                    onChange={(e) =>
                      setDraft({ ...draft, timeoutMs: Number(e.target.value) })
                    }
                  />
                </Field>
              </>
            )}
            {invalid && (
              <p role="alert" className="field-error">
                {t("error.VALIDATION_ERROR")}
              </p>
            )}
            <div className="dialog-footer">
              <Button disabled={busy} onClick={close}>
                {t("common.cancel")}
              </Button>
              {review && (
                <Button disabled={busy} onClick={() => setReview(false)}>
                  {t("common.previous")}
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={!allowed || busy || !changed}
              >
                {t(review ? "common.confirm" : "governance.review")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
