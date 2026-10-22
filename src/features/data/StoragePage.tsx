import { formatResourceId } from "../../lib/ids";
import { Link } from "react-router-dom";
import { useUrlState } from "../shared/useUrlState";
import { bucketSummary, selectBucketRows } from "../shared/storageView";
import { BucketTable } from "./BucketTable";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState, type DragEvent } from "react";
import type { Bucket, StorageObject, Project, Quota } from "../../types/domain";
import { EP, query, post, remove, api } from "../../lib/api-client";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
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
  const [bucketProject, setBucketProject] = useState(projectId);
  const [search, setSearch] = useUrlState("q");
  const [projectFilter, setProjectFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
  const projects = useData<Project[]>(["projects"], EP.projects);
  const quotas = useData<Quota[]>(
    ["storage-quotas", region],
    EP.quotas + query({ region }),
  );
  const objectQuota = quotas.data
    ?.find((item) => item.metric === "storage")
    ?.storageBreakdown?.find((item) => item.kind === "object");
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
  const projectName = (value?: string) =>
    dt(projects.data?.find((project) => project.id === value)?.name || value || "—");
  const bucketRows = selectBucketRows(q.data || [],
    { search, projectId: projectFilter, storageClass: classFilter, status: statusFilter },
    projectName,
  );
  const { actualBytes, limitGb: bucketLimitGb, objectCount } = bucketSummary(bucketRows);
  const filterActive = !!(search || projectFilter || classFilter || statusFilter);
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
        subtitle={t("storage.objectSubtitle")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => {
              setBucketProject(projectId);
              setNewOpen(true);
            }}
          >
            {t("storage.new")}
          </Button>
        }
      />
      <div className="grid grid-4 resource-summary-grid storage-object-summary">
        <Panel title={t("storage.bucketCount")} className="resource-summary-card"><div className="resource-summary-value">{q.data ? bucketRows.length : "—"}</div><small>{t("nav.object")}</small></Panel>
        <Panel title={t("storage.totalBucketLimits")} className="resource-summary-card"><div className="resource-summary-value">{q.data ? size(bucketLimitGb) : "—"}<span className="resource-unit">{t("storage.configuredLimit")}</span></div><small>{t("storage.bucketLimitIndependent")}</small></Panel>
        <Panel title={t("storage.actualUsage")} className="resource-summary-card"><div className="resource-summary-value">{q.data ? size(actualBytes / 1e9) : "—"}</div><small>{t("storage.fromObjectRecords")}</small></Panel>
        <Panel title={t("storage.objects")} className="resource-summary-card"><div className="resource-summary-value">{q.data ? objectCount : "—"}</div><small>{t("storage.objectCount")}</small></Panel>
      </div>
      <Panel title={t("storage.regionalObjectQuota")} className="storage-regional-quota">
        {objectQuota ? <><div className="between"><strong>{t("storage.regionalQuotaRemaining")}: {size(Math.max(0, objectQuota.limitGb - objectQuota.usedGb))}</strong><small>{t("storage.regionUsage", { used: objectQuota.usedGb.toLocaleString(), limit: objectQuota.limitGb.toLocaleString() })} GB</small></div><Progress value={objectQuota.limitGb > 0 ? objectQuota.usedGb / objectQuota.limitGb * 100 : 0} /></> : <small>—</small>}
        <small>{t("storage.regionQuotaUsesActual")}</small>
      </Panel>
      <div className="toolbar storage-volume-filters">
        <RegionFilter />
        <input className="input search" aria-label={t("common.search")} placeholder={t("common.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={t("common.project")} value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("common.allProjects")}</option>
          {projects.data?.filter((project) => !project.deletedAt).map((project) => <option key={project.id} value={project.id}>{dt(project.name)} · {formatResourceId("prj", project.id)}</option>)}
        </select>
        <select aria-label={t("storage.tier")} value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
          <option value="">{t("storage.allTiers")}</option><option value="STANDARD">STANDARD</option><option value="IA">IA</option>
        </select>
        <select aria-label={t("common.status")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">{t("storage.allStatuses")}</option><option value="active">{t("common.active")}</option>
        </select>
        {filterActive && <Button onClick={() => { setSearch(""); setProjectFilter(""); setClassFilter(""); setStatusFilter(""); }}>{t("common.reset")}</Button>}
      </div>
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : bucketRows.length ? (
          <BucketTable
            buckets={bucketRows}
            projectName={projectName}
            onDetails={(selectedBucket) => {
              setId(selectedBucket.id);
              setPrefix("");
              setTab("objects");
            }}
          />
        ) : <Empty text={t(filterActive ? "common.noResults" : "storage.noBuckets")} />}
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
            <Panel title={t("storage.bucketDetails")}>
              <KeyValues
                items={[
                  ["ID", formatResourceId("obj", bucket.id)],
                  [t("common.name"), bucket.name],
                  [t("common.region"), t("common." + bucket.region)],
                  [t("storage.tier"), bucket.storageClass || "STANDARD"],
                  [t("storage.bucketLimit"), size(bucket.quotaGb)],
                  [t("storage.actualUsage"), overview.data ? size(overview.data.usedGb) : t("storage.noUsageData")],
                  [t("storage.objects"), overview.data?.objectCount ?? "—"],
                  [t("common.project"), `${projectName(bucket.projectId)} · ${formatResourceId("prj", bucket.projectId || "")}`],
                  [t("common.status"), t("common.active")],
                  [t("storage.accessPolicy"), t("common." + bucket.access)],
                  [
                    t("storage.source"),
                    t(
                      bucket.attachedResourceUuid
                        ? "storage.deploymentSource"
                        : "storage.standaloneSource",
                    ),
                  ],
                  [t("common.createdAt"), date(bucket.createdAt)],
                ]}
              />
            </Panel>
            <Panel title={t("storage.accessDetails")}>
              <KeyValues items={[
                [t("storage.accessPolicy"), t("common." + bucket.access)],
                [t("storage.attached"), bucket.references[0]?.name || t("storage.unattached")],
                [t("storage.lifecycle"), String(bucket.lifecycle.length)],
              ]} />
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
                  disabled={
                    !canWrite(role) ||
                    busy ||
                    bucket.objects.length > 0 ||
                    bucket.references.length > 0
                  }
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
              {(bucket.objects.length > 0 || bucket.references.length > 0) && (
                <small>{t("storage.bucketDeleteHint")}</small>
              )}
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
              <small>{t("storage.bucketLimitHint")}</small>
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
                <small>{t("storage.lifecycleHint")}</small>
                <DataTable
                  data={bucket.lifecycle}
                  columns={[
                    { accessorKey: "prefix", header: t("storage.prefix") },
                    {
                      accessorKey: "action",
                      header: t("common.action"),
                      cell: ({ row }) =>
                        t(`storage.lifecycleAction.${row.original.action}`),
                    },
                    {
                      accessorKey: "after_days",
                      header: t("storage.afterDays"),
                    },
                    {
                      accessorKey: "nextRun",
                      header: t("common.time"),
                      cell: ({ row }) => date(row.original.nextRun),
                    },
                    {
                      id: "remove",
                      header: t("common.action"),
                      cell: ({ row }) => (
                        <Button
                          variant="danger"
                          disabled={!canWrite(role) || busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void run(() =>
                              api(`${EP.buckets}/${id}/lifecycle`, {
                                method: "PUT",
                                body: JSON.stringify({
                                  rules: bucket.lifecycle.filter(
                                    (_, index) => index !== row.index,
                                  ),
                                }),
                              }),
                            );
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      ),
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
                      step={1}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                    {(!Number.isInteger(days) || days < 1 || days > 3650) && (
                      <small className="field-error">
                        {t("wizard.lifecycleDaysInvalid")}
                      </small>
                    )}
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
                      !canWrite(role) ||
                      !Number.isInteger(days) ||
                      days < 1 ||
                      days > 3650 ||
                      busy
                    }
                    onClick={() =>
                      void run(() =>
                        api(`${EP.buckets}/${id}/lifecycle`, {
                          method: "PUT",
                          body: JSON.stringify({
                            rules: [
                              ...bucket.lifecycle,
                              {
                                prefix: rulePrefix.trim(),
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
            <Field label={t("common.project")}>
              <select
                value={bucketProject}
                onChange={(event) => setBucketProject(event.target.value)}
              >
                {projects.data
                  ?.filter((project) => !project.deletedAt)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {dt(project.name)} · {formatResourceId("prj", project.id)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("common.region")}>
              <strong>{t(`common.${region}`)}</strong>
            </Field>
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
              quotaGb % 100 !== 0 ||
              !bucketProject
            }
            onClick={async () => {
              const b = await run(
                () =>
                  post<Bucket>(EP.buckets, {
                    name,
                    region,
                    projectId: bucketProject,
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
                step={1}
                value={expires}
                onChange={(e) => setExpires(Number(e.target.value))}
              />
              {(!Number.isInteger(expires) ||
                expires < 60 ||
                expires > 604800) && (
                <small className="field-error">
                  {t("wizard.shareExpiryInvalid")}
                </small>
              )}
            </Field>
            <div className="row">
              <Button
                disabled={
                  !Number.isInteger(expires) ||
                  expires < 60 ||
                  expires > 604800 ||
                  busy
                }
                onClick={() => void objectAction(selected, "share")}
              >
                {t("storage.share")}
              </Button>
              <Button
                disabled={
                  !Number.isInteger(expires) ||
                  expires < 60 ||
                  expires > 604800 ||
                  busy
                }
                onClick={() => void objectAction(selected, "download")}
              >
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
