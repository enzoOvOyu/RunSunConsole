import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Notebook, Resource, Image } from "../../types/domain";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { EP, query, post, remove } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useAction, useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { date } from "../../lib/date";
import {
  Button,
  PageHeader,
  Panel,
  Modal,
  Field,
  DataTable,
  Badge,
  Empty,
  Loading,
  ErrorState,
  CopyButton,
} from "../../components/ui";
export default function NotebooksPage() {
  const [params] = useSearchParams();
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const [open, setOpen] = useState(!!params.get("resource"));
  const [selected, setSelected] = useState(params.get("resource") || "");
  const [ide, setIde] = useState("jupyter");
  const [storage, setStorage] = useState(50);
  const [idle, setIdle] = useState(60);
  const [kind, setKind] = useUrlState("kind");
  const [connection, setConnection] = useState<Notebook | null>(null);
  const q = useData<Notebook[]>(
    ["notebooks", region, kind],
    EP.notebooks + query({ region, resource_kind: kind }),
  );
  const rs = useData<{ items: Resource[] }>(
    ["notebook-hosts", region],
    EP.resources + query({ region, size: 1000 }),
  );
  const images = useData<Image[]>(["images"], EP.images);
  const { run, busy } = useAction();
  const hosts =
    rs.data?.items.filter(
      (r) => r.kind !== "inference" && r.status === "running",
    ) || [];
  return (
    <>
      <PageHeader
        title={t("nav.notebooks")}
        subtitle={t("pageDescription.notebooks")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setOpen(true)}
          >
            {t("notebook.new")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter />
        <select
          aria-label={t("common.type")}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">{t("common.all")}</option>
          {["gpu_vm", "gpu_baremetal", "vgpu"].map((k) => (
            <option key={k} value={k}>
              {t("common." + k)}
            </option>
          ))}
        </select>
      </div>
      <div className="notice" style={{ marginBottom: 20 }}>
        {t("notebook.hostHint")}
      </div>
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={q.data || []}
            onRow={setConnection}
            columns={[
              {
                accessorKey: "name",
                header: t("common.name"),
                cell: ({ row }) => dt(row.original.name),
              },
              { accessorKey: "ide", header: "IDE" },
              {
                accessorKey: "status",
                header: t("common.status"),
                cell: ({ row }) => <Badge status={row.original.status} />,
              },
              {
                id: "host",
                header: t("notebook.host"),
                cell: ({ row }) => {
                  const r = rs.data?.items.find(
                    (r) => r.resourceUuid === row.original.resourceUuid,
                  );
                  return r ? (
                    <Link
                      to={resourceLink(r)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.displayId}
                    </Link>
                  ) : (
                    "—"
                  );
                },
              },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
              {
                id: "actions",
                header: t("common.actions"),
                cell: ({ row }) => (
                  <Button
                    variant="danger"
                    disabled={!canWrite(role)}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await confirmAction(
                          t("common.delete") + " " + dt(row.original.name),
                        )
                      )
                        void run(() =>
                          remove(EP.notebooks + "/" + row.original.id),
                        );
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </div>
      <Modal
        drawer
        small
        open={open}
        onClose={() => setOpen(false)}
        title={t("notebook.new")}
      >
        {hosts.length ? (
          <div className="stack">
            <Field label={t("notebook.host")}>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">{t("notebook.host")}</option>
                {hosts.map((r) => (
                  <option key={r.resourceUuid} value={r.resourceUuid}>
                    {dt(r.name)} · {r.displayId} · {r.spec.gpuCount} GPU
                  </option>
                ))}
              </select>
            </Field>
            <Field label="IDE">
              <select value={ide} onChange={(e) => setIde(e.target.value)}>
                {["jupyter", "vscode"].map((i) => (
                  <option key={i} value={i}>
                    {images.data?.find((image) => image.id === i)?.name || i}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("quota.storage")}>
              <input
                className="input"
                type="number"
                min={1}
                max={
                  hosts.find((r) => r.resourceUuid === selected)?.spec
                    .storageGb || 100
                }
                value={storage}
                onChange={(e) => setStorage(Number(e.target.value))}
              />
            </Field>
            <Field label={t("notebook.idle")}>
              <select
                value={idle}
                onChange={(e) => setIdle(Number(e.target.value))}
              >
                {[0, 30, 60, 120].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              disabled={!selected || busy || !canWrite(role)}
              variant="primary"
              onClick={async () => {
                const n = await run(
                  () =>
                    post<Notebook>(EP.notebooks, {
                      resourceUuid: selected,
                      ide,
                      imageRef: ide,
                      storageGb: storage,
                      autoShutdownIdleMin: idle,
                    }),
                  "success.created",
                );
                if (n) setOpen(false);
              }}
            >
              {t("common.create")}
            </Button>
          </div>
        ) : (
          <Empty
            text={t("notebook.noHost")}
            action={<Link to="/deployment/server">{t("common.create")}</Link>}
          />
        )}
      </Modal>
      <Modal
        open={!!connection}
        onClose={() => setConnection(null)}
        title={connection ? dt(connection.name) : t("notebook.open")}
      >
        <Panel title={t("common.endpoint")}>
          <code>{connection?.urlPath}</code>
          <CopyButton value={connection?.urlPath || ""} />
        </Panel>
      </Modal>
    </>
  );
}
