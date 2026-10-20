import { Link } from "react-router-dom";
import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState, type DragEvent } from "react";
import type { Bucket, StorageObject } from "../../types/domain";
import { EP, query, post, remove, api } from "../../lib/api-client";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { t } from "../../i18n";
import { date } from "../../lib/date";
import { size } from "../../lib/money";
import {
  PageHeader,
  Button,
  Panel,
  Modal,
  Field,
  DataTable,
  KeyValues,
  Progress,
  CopyButton,
  Empty,
  Loading,
  ErrorState,
  Tabs,
  copy,
  download,
} from "../../components/ui";
export default function StoragePage() {
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const projectId = useAuth((s) => s.project);
  const { id, setId } = useDrawer();
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [storageClass, setStorageClass] = useState<"STANDARD" | "IA">(
    "STANDARD",
  );
  const [quotaGb, setQuotaGb] = useState(2000);
  const [search, setSearch] = useUrlState("q");
  const [prefix, setPrefix] = useState("");
  const [tab, setTab] = useState("objects");
  const [grid, setGrid] = useState(false);
  const [selected, setSelected] = useState<StorageObject | null>(null);
  const [expires, setExpires] = useState(3600);
  const [rulePrefix, setRulePrefix] = useState("");
  const [days, setDays] = useState(30);
  const [ruleAction, setRuleAction] = useState("delete");
  const q = useData<Bucket[]>(
    ["buckets", region],
    EP.buckets + query({ region }),
  );
  const overview = useData<{
    bucket: Bucket;
    objectCount: number;
    usedGb: number;
    quotaGb: number;
    requests: { date: string; value: number }[];
  }>(["bucket-overview", id], `${EP.buckets}/${id}/overview`, {
    enabled: !!id,
  });
  const objects = useData<{ prefixes: string[]; objects: StorageObject[] }>(
    ["objects", id, prefix],
    `${EP.buckets}/${id}/objects` + query({ prefix }),
    { enabled: !!id },
  );
  const { run, busy } = useAction();
  const bucket = overview.data?.bucket;
  const upload = async (files: FileList | null) => {
    if (!files || !id) return;
    for (const file of Array.from(files)) {
      await run(async () => {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        return post(`${EP.buckets}/${id}/objects`, {
          key: prefix + file.name,
          size: file.size,
          contentType: file.type,
          content,
        });
      }, "success.created");
    }
  };
  const objectAction = async (o: StorageObject, kind: "share" | "download") => {
    const result = await run(() =>
      api<{ url: string }>(
        `${EP.buckets}/${id}/sign` + query({ key: o.key, expires }),
      ),
    );
    if (result) {
      if (kind === "share") await copy(result.url);
      else if (result.url.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = result.url;
        a.download = o.key.split("/").at(-1) || "object";
        a.click();
      } else download(o.key.split("/").at(-1) + ".url", result.url);
    }
  };
  return (
    <>
      <PageHeader
        title={t("nav.object")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setNewOpen(true)}
          >
            {t("storage.new")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter />
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={(q.data || []).filter((b) => b.name.includes(search))}
            onRow={(b) => {
              setId(b.id);
              setPrefix("");
              setTab("objects");
            }}
            columns={[
              { accessorKey: "name", header: t("common.name") },
              {
                accessorKey: "region",
                header: t("common.region"),
                cell: ({ row }) => t("common." + row.original.region),
              },
              {
                accessorKey: "storageClass",
                header: t("storage.tier"),
                cell: ({ row }) => row.original.storageClass || "STANDARD",
              },
              {
                id: "count",
                header: t("storage.objects"),
                cell: ({ row }) => row.original.objects.length,
              },
              {
                id: "capacity",
                header: t("storage.capacity"),
                cell: ({ row }) =>
                  size(
                    row.original.objects.reduce((a, o) => a + o.size, 0) / 1e9,
                  ),
              },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
              {
                accessorKey: "access",
                header: t("common.status"),
                cell: ({ row }) => t("common." + row.original.access),
              },
            ]}
          />
        )}
      </div>
      <Modal
        drawer
        open={!!id}
        onClose={() => {
          setId("");
          setSelected(null);
        }}
        title={bucket?.name || t("nav.object")}
      >
        {overview.isPending ? (
          <Loading />
        ) : overview.error ? (
          <ErrorState error={overview.error} />
        ) : bucket ? (
          <div className="stack">
            <Panel title={t("storage.volumeDetails")}>
              <KeyValues
                items={[
                  [t("common.region"), t("common." + bucket.region)],
                  [t("storage.tier"), bucket.storageClass || "STANDARD"],
                  [t("common.project"), bucket.projectId || "—"],
                  [t("storage.attached"), bucket.references[0]?.name || "—"],
                  [t("common.createdAt"), date(bucket.createdAt)],
                ]}
              />
            </Panel>
            {bucket.references[0] && (
              <Link to={bucket.references[0].href}>
                {t("storage.attached")}: {bucket.references[0].name}
              </Link>
            )}
            <Panel
              title={t("storage.capacity")}
              action={
                <Button
                  variant="danger"
                  disabled={!canWrite(role) || busy}
                  onClick={async () => {
                    if (
                      !(await confirmAction(
                        t("common.delete") + " " + bucket.name,
                      ))
                    )
                      return;
                    const ok = await run(async () => {
                      await remove(EP.buckets + "/" + id);
                      return true;
                    });
                    if (ok) setId("");
                  }}
                >
                  {t("common.delete")}
                </Button>
              }
            >
              <div className="between">
                <strong>
                  {size(overview.data.usedGb)} / {size(overview.data.quotaGb)}
                </strong>
                <span>
                  {overview.data.objectCount} {t("storage.objects")}
                </span>
              </div>
              <div style={{ margin: "12px 0" }}>
                <Progress
                  value={(overview.data.usedGb / overview.data.quotaGb) * 100}
                />
              </div>
              <div className="row">
                <code>s3.{bucket.region}.runsun.cloud</code>
                <CopyButton
                  value={`https://s3.${bucket.region}.runsun.cloud`}
                />
              </div>
              <small>
                {t("storage.requests")} ·{" "}
                {overview.data.requests.map((r) => r.value).join(" / ")}
              </small>
            </Panel>
            <Tabs
              items={["objects", "lifecycle"].map((id) => ({
                id,
                label: t("storage." + id),
              }))}
              value={tab}
              onChange={setTab}
            />
            {tab === "objects" ? (
              <div
                className="stack"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  if (canWrite(role)) void upload(e.dataTransfer.files);
                }}
              >
                <div className="between">
                  <div className="row">
                    <Button onClick={() => setPrefix("")}>{bucket.name}</Button>
                    {prefix
                      .split("/")
                      .filter(Boolean)
                      .map((part, i, parts) => (
                        <Button
                          key={i}
                          onClick={() =>
                            setPrefix(parts.slice(0, i + 1).join("/") + "/")
                          }
                        >
                          / {part}
                        </Button>
                      ))}
                  </div>
                  <div className="row">
                    <Button onClick={() => setGrid(!grid)}>
                      {t(grid ? "storage.list" : "storage.grid")}
                    </Button>
                    <label className="btn">
                      {t("common.upload")}
                      <input
                        className="sr-only"
                        type="file"
                        multiple
                        disabled={!canWrite(role)}
                        onChange={(e) => void upload(e.target.files)}
                      />
                    </label>
                  </div>
                </div>
                {objects.data?.prefixes.map((p) => (
                  <Button key={p} onClick={() => setPrefix(p)}>
                    📁 {p.slice(prefix.length)}
                  </Button>
                ))}
                {objects.data?.objects.length ? (
                  grid ? (
                    <div className="grid grid-3">
                      {objects.data.objects.map((o) => (
                        <button
                          className="catalog-card"
                          key={o.key}
                          onClick={() => setSelected(o)}
                        >
                          <strong>{o.key.split("/").at(-1)}</strong>
                          <small>{size(o.size / 1e9)}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <DataTable
                      data={objects.data.objects}
                      onRow={setSelected}
                      columns={[
                        { accessorKey: "key", header: t("common.key") },
                        {
                          accessorKey: "size",
                          header: t("common.size"),
                          cell: ({ row }) => size(row.original.size / 1e9),
                        },
                        {
                          accessorKey: "storageClass",
                          header: t("common.type"),
                        },
                        {
                          accessorKey: "updatedAt",
                          header: t("common.updatedAt"),
                          cell: ({ row }) => date(row.original.updatedAt),
                        },
                      ]}
                    />
                  )
                ) : (
                  <Empty text={t("storage.empty")} />
                )}
              </div>
            ) : (
              <div className="stack">
                <DataTable
                  data={bucket.lifecycle}
                  columns={[
                    { accessorKey: "prefix", header: t("storage.prefix") },
                    { accessorKey: "action", header: t("common.action") },
                    {
                      accessorKey: "after_days",
                      header: t("storage.afterDays"),
                    },
                    {
                      accessorKey: "nextRun",
                      header: t("common.time"),
                      cell: ({ row }) => date(row.original.nextRun),
                    },
                  ]}
                />
                <div className="form-grid">
                  <Field label={t("storage.prefix")}>
                    <input
                      className="input"
                      value={rulePrefix}
                      onChange={(e) => setRulePrefix(e.target.value)}
                    />
                  </Field>
                  <Field label={t("storage.afterDays")}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={3650}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </Field>
                  <Field label={t("common.action")}>
                    <select
                      value={ruleAction}
                      onChange={(e) => setRuleAction(e.target.value)}
                    >
                      <option value="delete">{t("common.delete")}</option>
                      <option value="infrequent">INFREQUENT_ACCESS</option>
                    </select>
                  </Field>
                  <Button
                    disabled={
                      !canWrite(role) || days < 1 || days > 3650 || busy
                    }
                    onClick={() =>
                      void run(() =>
                        api(`${EP.buckets}/${id}/lifecycle`, {
                          method: "PUT",
                          body: JSON.stringify({
                            rules: [
                              ...bucket.lifecycle,
                              {
                                prefix: rulePrefix,
                                action: ruleAction,
                                after_days: days,
                              },
                            ],
                          }),
                        }),
                      )
                    }
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={t("storage.new")}
      >
        <div className="stack">
          <Field label={t("common.name")} hint="3–63 · a–z / 0–9 / -">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t("storage.tier")}>
              <select
                value={storageClass}
                onChange={(e) =>
                  setStorageClass(e.target.value as "STANDARD" | "IA")
                }
              >
                <option value="STANDARD">STANDARD</option>
                <option value="IA">IA</option>
              </select>
            </Field>
            <Field label={t("storage.quotaGb")}>
              <input
                className="input"
                type="number"
                min={100}
                max={1048500}
                step={100}
                value={quotaGb}
                onChange={(e) => setQuotaGb(Number(e.target.value))}
              />
            </Field>
          </div>
          <Button
            disabled={
              !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) ||
              busy ||
              quotaGb < 100 ||
              quotaGb > 1048500 ||
              quotaGb % 100 !== 0
            }
            onClick={async () => {
              const b = await run(
                () =>
                  post<Bucket>(EP.buckets, {
                    name,
                    region,
                    projectId,
                    storageClass,
                    quotaGb,
                  }),
                "success.created",
              );
              if (b) {
                setNewOpen(false);
                setId(b.id);
              }
            }}
          >
            {t("common.create")}
          </Button>
        </div>
      </Modal>
      <Modal
        small
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t("storage.metadata")}
      >
        {selected && (
          <div className="stack">
            <KeyValues
              items={[
                [t("common.key"), selected.key],
                [t("common.size"), size(selected.size / 1e9)],
                ["Content-Type", selected.contentType],
                ["ETag", selected.etag],
                ["Storage Class", selected.storageClass],
                [t("common.updatedAt"), date(selected.updatedAt)],
              ]}
            />
            <Field label={t("storage.expiry")} hint="60–604800">
              <input
                className="input"
                type="number"
                min={60}
                max={604800}
                value={expires}
                onChange={(e) => setExpires(Number(e.target.value))}
              />
            </Field>
            <div className="row">
              <Button onClick={() => void objectAction(selected, "share")}>
                {t("storage.share")}
              </Button>
              <Button onClick={() => void objectAction(selected, "download")}>
                {t("common.download")}
              </Button>
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      t("common.delete") + " " + selected.key,
                    ))
                  )
                    return;
                  const ok = await run(async () => {
                    await remove(
                      `${EP.buckets}/${id}/objects` +
                        query({ key: selected.key }),
                    );
                    return true;
                  });
                  if (ok) setSelected(null);
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
