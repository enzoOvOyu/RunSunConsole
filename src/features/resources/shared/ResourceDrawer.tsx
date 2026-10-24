import { useResourceTransition } from "../../../stores/resourceTransition";
import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import type { Resource } from "../../../types/domain";
import { useAuth } from "../../../stores/auth";
import { canWrite } from "../../../lib/rbac";
import { KIND_META, formatResourceId } from "../../../lib/ids";
import { EP, post, remove, query } from "../../../lib/api-client";
import { useAction } from "../../shared/hooks";
import { t, dt } from "../../../i18n";
import {
  Modal,
  Button,
  Badge,
  Field,
  ErrorState,
  Loading,
  KeyValues,
  toast,
} from "../../../components/ui";
import { ServerDetail } from "../servers/ServerDetail";
import { BaremetalDetail } from "../baremetal/BaremetalDetail";
import { VgpuDetail } from "../vgpu/VgpuDetail";
import { InferenceDetail } from "../inference/InferenceDetail";
import { Provisioning } from "./common";
import { useQuery } from "@tanstack/react-query";
import { fetchHistoricalResource } from "./api";
export function ResourceDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("drawer");
  const q = useQuery({
    queryKey: ["resource", id],
    queryFn: () => fetchHistoricalResource(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [credential, setCredential] = useState("");
  const [operation, setOperation] = useState("");
  const [count, setCount] = useState(1);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const role = useAuth((s) => s.role);
  const { run, busy } = useAction();
  const navigate = useNavigate();
  const r = q.data;
  const close = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const p = new URLSearchParams(params);
    p.delete("drawer");
    setParams(p);
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const allowed = canWrite(role) && !r?.deletedAt;
  const act = async (action: string, body: unknown = {}) => {
    if (!r) return undefined;
    const result = await run(() =>
      post<Resource & { credential?: string }>(
        `${EP.resources}/${r.resourceUuid}/${action}`,
        body,
      ),
    );
    if (result?.credential) setCredential(result.credential);
    setOperation("");
    return result;
  };
  const actAndRefresh = async (action: string) => {
    const result = await act(action);
    await q.refetch();
    return result;
  };
  const performDelete = async () => {
    if (!r) return;
    setError(null);
    try {
      const deleted = await remove<Resource>(
        `${EP.resources}/${r.resourceUuid}` + query({ confirm }),
      );
      useResourceTransition.getState().mark(deleted);
      toast(t("resource.deleted"));
      setDeleting(false);
      await q.refetch();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(close, 1800);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <>
      <Modal
        open={!!id}
        onClose={close}
        drawer
        title={
          r ? (
            <span className="row">
              {(() => {
                const Icon = KIND_META[r.kind].icon;
                return (
                  <Icon size={22} style={{ color: KIND_META[r.kind].color }} />
                );
              })()}
              {dt(r.name)}{" "}
              <Badge status={r.deletedAt ? "released" : r.status} />
            </span>
          ) : (
            t("common.details")
          )
        }
        description={
          r ? (
            <>
              <span className="resource-id">{r.displayId}</span>
              {` · ${t("common." + r.region)} · ${r.project ? dt(r.project.name) : formatResourceId("prj", r.projectId)}`}
            </>
          ) : undefined
        }
      >
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : r ? (
          <div className="stack">
            {r.deletedAt ? (
              <div className="notice">{t("resource.history")}</div>
            ) : (
              <div className="row">
                <Button
                  disabled={!allowed || r.status !== "stopped" || busy}
                  title={!allowed ? t("common.readOnly") : undefined}
                  onClick={() => void act("start")}
                >
                  {t("resource.start")}
                </Button>
                <Button
                  disabled={!allowed || r.status !== "running" || busy}
                  onClick={() => void act("stop")}
                >
                  {t("resource.stop")}
                </Button>
                <Button
                  disabled={!allowed || r.status !== "running" || busy}
                  onClick={() => void act("restart")}
                >
                  {t("resource.restart")}
                </Button>
                {r.status === "error" && (
                  <Button
                    disabled={!allowed || busy}
                    onClick={() => void act("retry")}
                  >
                    {t("common.retry")}
                  </Button>
                )}
                {r.kind === "gpu_vm" && (
                  <>
                    <Button
                      disabled={!allowed}
                      onClick={() =>
                        navigate(`/deployment/server?clone=${r.resourceUuid}`)
                      }
                    >
                      {t("resource.clone")}
                    </Button>
                    <Button
                      disabled={!allowed || r.status !== "stopped"}
                      onClick={() => void act("no-gpu")}
                    >
                      {t("resource.noGpu")}
                    </Button>
                    <Button
                      disabled={!allowed}
                      onClick={() => void act("reset-password")}
                    >
                      {t("resource.resetPassword")}
                    </Button>
                  </>
                )}
                {r.kind === "gpu_baremetal" && (
                  <>
                    <Button
                      disabled={!allowed || r.status !== "stopped"}
                      onClick={() => setOperation("rescue")}
                    >
                      {t("resource.rescue")}
                    </Button>
                    <Button
                      disabled={!allowed || r.status !== "stopped"}
                      onClick={() => setOperation("reset-os")}
                    >
                      {t("resource.resetOs")}
                    </Button>
                  </>
                )}
                {r.kind === "inference" && (
                  <Button
                    disabled={!allowed}
                    onClick={() => {
                      setCount(r.spec.replicas);
                      setOperation("resize");
                    }}
                  >
                    {t("resource.expand")}
                  </Button>
                )}
                <Button
                  variant="danger"
                  disabled={!allowed}
                  title={!allowed ? t("common.readOnly") : undefined}
                  onClick={() => {
                    setConfirm("");
                    setError(null);
                    setDeleting(true);
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            )}
            <Provisioning resource={r} />
            {r.kind === "gpu_vm" ? (
              <ServerDetail
                resource={r as Extract<Resource, { kind: "gpu_vm" }>}
                canManage={allowed}
                onStart={() => actAndRefresh("start")}
                onStop={() => actAndRefresh("stop")}
                onRestart={() => actAndRefresh("restart")}
              />
            ) : r.kind === "gpu_baremetal" ? (
              <BaremetalDetail resource={r} />
            ) : r.kind === "vgpu" ? (
              <VgpuDetail resource={r} />
            ) : (
              <InferenceDetail resource={r} />
            )}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t("resource.deleteTitle")}
        description={t("resource.deleteImpact")}
      >
        {r && (
          <div className="stack">
            <KeyValues
              items={[
                [t("common.name"), dt(r.name)],
                [t("common.type"), t(`common.${r.kind}`)],
                ["ID", <span className="resource-id">{r.displayId}</span>],
                [t("common.status"), <Badge status={r.status} />],
                ["GPU", r.spec.gpuCount],
                [t("quota.storage"), `${r.spec.storageGb} GB`],
              ]}
            />
            {r.status === "running" && (
              <div className="notice warning">{t("resource.stopFirst")}</div>
            )}
            <Field label={t("resource.deleteInput", { id: r.displayId })}>
              <input
                autoComplete="off"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            {!!error && (
              <>
                <ErrorState error={error} />
                {error instanceof Error && "details" in error && (
                  <div className="stack">
                    {Array.isArray(
                      (error.details as Record<string, unknown>).dependencies,
                    ) ? (
                      (
                        error.details as {
                          dependencies: { name: string; href: string }[];
                        }
                      ).dependencies.map((dep) => (
                        <Link key={dep.href + dep.name} to={dep.href}>
                          {dt(dep.name)}
                        </Link>
                      ))
                    ) : (
                      <pre>{JSON.stringify(error.details, null, 2)}</pre>
                    )}
                  </div>
                )}
              </>
            )}
            <Button
              variant="danger"
              disabled={(confirm !== r.displayId && confirm !== r.name) || busy}
              onClick={() => void performDelete()}
            >
              {t("common.delete")}
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        open={!!credential}
        onClose={() => setCredential("")}
        title={t("resource.passwordOnce")}
      >
        <pre>{credential}</pre>
      </Modal>
      <Modal
        open={!!operation}
        onClose={() => setOperation("")}
        title={t("common.confirm")}
      >
        <div className="stack">
          <p>
            {operation === "resize"
              ? t("resource.expand")
              : t("common.warning")}
          </p>
          {operation === "resize" && (
            <Field label={t("common.count") + " · 1–32"}>
              <input
                className="input"
                type="number"
                min={1}
                max={32}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
          )}
          <Button
            variant="primary"
            disabled={busy || count < 1 || count > 32}
            onClick={() => void act(operation, { count })}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
