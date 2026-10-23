import { formatResourceId } from "../../lib/ids";
import { Link } from "react-router-dom";
import { useUrlState } from "../shared/useUrlState";
import { bucketSummary, selectBucketRows } from "../shared/storageView";
import { BucketTable } from "./BucketTable";
import { S3FilesPanel } from "./S3FilesPanel";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useEffect, useState, type DragEvent } from "react";
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [createBlockPublic, setCreateBlockPublic] = useState(true);
  const [createEncryption, setCreateEncryption] = useState(true);
  const [createVersioning, setCreateVersioning] = useState(false);
  const [createTagKey, setCreateTagKey] = useState("");
  const [createTagValue, setCreateTagValue] = useState("");
  const [settings, setSettings] = useState({
    blockPublicAccess: true,
    defaultEncryption: true,
    versioning: false,
    access: "private" as "private" | "public_read",
    tags: {} as Record<string, string>,
  });
  const [tagKey, setTagKey] = useState("");
  const [tagValue, setTagValue] = useState("");
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPage, setObjectPage] = useState(1);
  const [objectPageSize, setObjectPageSize] = useState(10);
  const [folderName, setFolderName] = useState("");
  const [search, setSearch] = useUrlState("q");
  const [projectFilter, setProjectFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");
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
    measuredAt: string;
    requests: null;
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
  useEffect(() => {
    if (!bucket) return;
    setSettings({
      blockPublicAccess: bucket.blockPublicAccess !== false,
      defaultEncryption: bucket.defaultEncryption !== false,
      versioning: !!bucket.versioning,
      access: bucket.access,
      tags: bucket.tags || {},
    });
  }, [bucket]);
  const directObjects = objects.data?.objects || [];
  const visibleObjects = directObjects.filter((item) =>
    item.key.toLowerCase().includes(objectSearch.trim().toLowerCase()),
  );
  const pageCount = Math.max(
    1,
    Math.ceil(visibleObjects.length / objectPageSize),
  );
  const pageObjects = visibleObjects.slice(
    (Math.min(objectPage, pageCount) - 1) * objectPageSize,
    Math.min(objectPage, pageCount) * objectPageSize,
  );
  const projectName = (value?: string) =>
    dt(
      projects.data?.find((project) => project.id === value)?.name ||
        value ||
        "—",
    );
  const bucketRows = selectBucketRows(
    q.data || [],
    {
      search,
      projectId: projectFilter,
      storageClass: classFilter,
      status: statusFilter,
      fileInterface: fileFilter,
    },
    projectName,
  );
  const {
    actualBytes,
    limitGb: bucketLimitGb,
    objectCount,
  } = bucketSummary(bucketRows);
  const filterActive = !!(
    search ||
    projectFilter ||
    classFilter ||
    statusFilter ||
    fileFilter
  );
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
  const saveSettings = async () => {
    if (!bucket) return;
    const weakens =
      (bucket.blockPublicAccess !== false && !settings.blockPublicAccess) ||
      (bucket.defaultEncryption !== false && !settings.defaultEncryption) ||
      (bucket.access === "private" && settings.access === "public_read");
    if (
      weakens &&
      !(await confirmAction(t("storage.securityConfirm") + " " + bucket.name))
    )
      return;
    await run(() =>
      api(`${EP.buckets}/${bucket.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          confirm: weakens ? bucket.name : undefined,
        }),
      }),
    );
  };
  const createFolder = async () => {
    const segment = folderName.trim();
    if (
      !id ||
      !segment ||
      segment.includes("/") ||
      segment === "." ||
      segment === ".."
    )
      return;
    const created = await run(
      () =>
        post(`${EP.buckets}/${id}/objects`, {
          key: `${prefix}${segment}/`,
          size: 0,
          contentType: "application/x-directory",
          content: "",
        }),
      "success.created",
    );
    if (created) setFolderName("");
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
        <Panel
          title={t("storage.bucketCount")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">
            {q.data ? bucketRows.length : "—"}
          </div>
          <small>{t("nav.object")}</small>
        </Panel>
        <Panel
          title={t("storage.totalBucketLimits")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">
            {q.data ? size(bucketLimitGb) : "—"}
            <span className="resource-unit">
              {t("storage.configuredLimit")}
            </span>
          </div>
          <small>{t("storage.bucketLimitIndependent")}</small>
        </Panel>
        <Panel
          title={t("storage.actualUsage")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">
            {q.data ? size(actualBytes / 1e9) : "—"}
          </div>
          <small>{t("storage.fromObjectRecords")}</small>
        </Panel>
        <Panel title={t("storage.objects")} className="resource-summary-card">
          <div className="resource-summary-value">
            {q.data ? objectCount : "—"}
          </div>
          <small>{t("storage.objectCount")}</small>
        </Panel>
      </div>
      <Panel
        title={t("storage.regionalObjectQuota")}
        className="storage-regional-quota"
      >
        {objectQuota ? (
          <>
            <div className="between">
              <strong>
                {t("storage.regionalQuotaRemaining")}:{" "}
                {size(Math.max(0, objectQuota.limitGb - objectQuota.usedGb))}
              </strong>
              <small>
                {t("storage.regionUsage", {
                  used: objectQuota.usedGb.toLocaleString(),
                  limit: objectQuota.limitGb.toLocaleString(),
                })}{" "}
                GB
              </small>
            </div>
            <Progress
              value={
                objectQuota.limitGb > 0
                  ? (objectQuota.usedGb / objectQuota.limitGb) * 100
                  : 0
              }
            />
          </>
        ) : (
          <small>—</small>
        )}
        <small>{t("storage.regionQuotaUsesActual")}</small>
      </Panel>
      <div className="toolbar storage-volume-filters">
        <RegionFilter />
        <input
          className="input search"
          aria-label={t("common.search")}
          placeholder={t("common.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={t("common.project")}
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
        >
          <option value="">{t("common.allProjects")}</option>
          {projects.data
            ?.filter((project) => !project.deletedAt)
            .map((project) => (
              <option key={project.id} value={project.id}>
                {dt(project.name)} · {formatResourceId("prj", project.id)}
              </option>
            ))}
        </select>
        <select
          aria-label={t("storage.tier")}
          value={classFilter}
          onChange={(event) => setClassFilter(event.target.value)}
        >
          <option value="">{t("storage.allTiers")}</option>
          <option value="STANDARD">STANDARD</option>
          <option value="IA">IA</option>
        </select>
        <select
          aria-label={t("storage.accessPolicy")}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">{t("storage.allAccess")}</option>
          <option value="private">{t("common.private")}</option>
          <option value="public_read">{t("common.public_read")}</option>
        </select>
        <select
          aria-label={t("storage.s3FilesTitle")}
          value={fileFilter}
          onChange={(event) => setFileFilter(event.target.value)}
        >
          <option value="">{t("storage.s3FilesAll")}</option>
          <option value="configured">{t("storage.s3FilesPreviewOnly")}</option>
          <option value="unconfigured">{t("storage.s3FilesUnconfigured")}</option>
        </select>
        {filterActive && (
          <Button
            onClick={() => {
              setSearch("");
              setProjectFilter("");
              setClassFilter("");
              setStatusFilter("");
              setFileFilter("");
            }}
          >
            {t("common.reset")}
          </Button>
        )}
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
              setObjectPage(1);
            }}
            onManage={(selectedBucket) => {
              setId(selectedBucket.id);
              setTab("management");
            }}
            onFiles={(selectedBucket) => {
              setId(selectedBucket.id);
              setTab("s3-files");
            }}
          />
        ) : (
          <Empty
            text={t(filterActive ? "common.noResults" : "storage.noBuckets")}
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
            <Panel
              title={bucket.name}
              action={
                <Button
                  onClick={() => void copy(formatResourceId("obj", bucket.id))}
                >
                  {t("storage.copyId")}
                </Button>
              }
            >
              <small className="resource-id">
                {formatResourceId("obj", bucket.id)} ·{" "}
                {projectName(bucket.projectId)} · {t("common." + bucket.region)}
              </small>
              <div className="row" style={{ marginTop: 12, gap: 16, flexWrap: "wrap" }}>
                <span>{t("storage.objects")}: <strong>{overview.data.objectCount}</strong></span>
                <span>{t("storage.actualUsage")}: <strong>{size(overview.data.usedGb)}</strong></span>
                <span>{t("storage.accessPolicy")}: <strong>{t("common." + bucket.access)}</strong></span>
                <span>{t("storage.s3FilesTitle")}: <strong>{t(bucket.fileInterface ? "storage.s3FilesPreviewOnly" : "storage.s3FilesUnconfigured")}</strong></span>
              </div>
            </Panel>
            <Panel
              title={t("storage.capacity")}
              action={
                <Button
                  variant="danger"
                  disabled={
                    !canWrite(role) ||
                    busy ||
                    bucket.objects.length > 0 ||
                    bucket.references.length > 0 ||
                    bucket.lifecycle.length > 0 ||
                    !!bucket.fileInterface
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
              {(bucket.objects.length > 0 ||
                bucket.references.length > 0 ||
                bucket.lifecycle.length > 0 ||
                !!bucket.fileInterface) && (
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
              items={[
                "objects",
                "s3-files",
                "properties",
                "permissions",
                "management",
                "monitoring",
              ].map((id) => ({
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
                        onChange={(e) => {
                          void upload(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div className="toolbar">
                  <input
                    className="input search"
                    aria-label={t("common.search")}
                    placeholder={t("storage.searchObjects")}
                    value={objectSearch}
                    onChange={(e) => {
                      setObjectSearch(e.target.value);
                      setObjectPage(1);
                    }}
                  />
                  <input
                    className="input"
                    aria-label={t("storage.folderName")}
                    placeholder={t("storage.folderName")}
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                  />
                  <Button
                    disabled={
                      !canWrite(role) ||
                      busy ||
                      !folderName.trim() ||
                      folderName.includes("/")
                    }
                    onClick={() => void createFolder()}
                  >
                    {t("storage.createFolder")}
                  </Button>
                </div>
                {prefix &&
                  bucket.objects.some((item) => item.key === prefix) && (
                    <Button
                      variant="danger"
                      disabled={!canWrite(role) || busy}
                      onClick={async () => {
                        if (
                          !(await confirmAction(
                            t("storage.deleteFolderConfirm") + " " + prefix,
                          ))
                        )
                          return;
                        const result = await run(async () => {
                          await remove(
                            `${EP.buckets}/${id}/objects` +
                              query({ key: prefix }),
                          );
                          return true;
                        });
                        if (result)
                          setPrefix(
                            prefix
                              .split("/")
                              .filter(Boolean)
                              .slice(0, -1)
                              .join("/") +
                              (prefix.split("/").filter(Boolean).length > 1
                                ? "/"
                                : ""),
                          );
                      }}
                    >
                      {t("storage.deleteFolder")}
                    </Button>
                  )}
                {objects.isPending ? (
                  <Loading />
                ) : objects.error ? (
                  <ErrorState error={objects.error} />
                ) : (
                  <>
                    {objects.data?.prefixes.map((p) => (
                      <Button key={p} onClick={() => setPrefix(p)}>
                        📁 {p.slice(prefix.length)}
                      </Button>
                    ))}
                    {visibleObjects.length ? (
                      grid ? (
                        <div className="grid grid-3">
                          {pageObjects.map((o) => (
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
                          data={pageObjects}
                          onRow={setSelected}
                          columns={[
                            {
                              accessorKey: "key",
                              header: t("common.key"),
                              cell: ({ row }) =>
                                row.original.key.slice(prefix.length),
                            },
                            {
                              id: "objectType",
                              header: t("storage.objectType"),
                              cell: ({ row }) =>
                                row.original.key.endsWith("/")
                                  ? t("storage.folder")
                                  : row.original.contentType,
                            },
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
                              id: "encryption",
                              header: t("storage.encryption"),
                              cell: ({ row }) =>
                                row.original.encryption === "none"
                                  ? t("storage.disabled")
                                  : "SSE",
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
                      <Empty
                        text={t(
                          objectSearch ? "common.noResults" : "storage.empty",
                        )}
                      />
                    )}
                    <div className="between">
                      <small>
                        {visibleObjects.length} {t("storage.objects")}
                      </small>
                      <div className="row">
                        <select
                          aria-label={t("storage.pageSize")}
                          value={objectPageSize}
                          onChange={(e) => {
                            setObjectPageSize(Number(e.target.value));
                            setObjectPage(1);
                          }}
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                        </select>
                        <Button
                          disabled={objectPage <= 1}
                          onClick={() => setObjectPage(objectPage - 1)}
                        >
                          {t("storage.prevPage")}
                        </Button>
                        <span>
                          {Math.min(objectPage, pageCount)} / {pageCount}
                        </span>
                        <Button
                          disabled={objectPage >= pageCount}
                          onClick={() => setObjectPage(objectPage + 1)}
                        >
                          {t("storage.nextPage")}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : tab === "management" ? (
              <div className="stack">
                <Panel title={t("storage.versioning")}>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={settings.versioning}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          versioning: e.target.checked,
                        })
                      }
                    />
                    {t("storage.keepVersions")}
                  </label>
                  <small>{t("storage.versioningHint")}</small>
                </Panel>
                <Panel title={t("storage.tags")}>
                  <div className="row">
                    <input
                      className="input"
                      value={tagKey}
                      placeholder="Key"
                      onChange={(e) => setTagKey(e.target.value)}
                    />
                    <input
                      className="input"
                      value={tagValue}
                      placeholder="Value"
                      onChange={(e) => setTagValue(e.target.value)}
                    />
                    <Button
                      disabled={!tagKey.trim() || !canWrite(role)}
                      onClick={() => {
                        setSettings({
                          ...settings,
                          tags: {
                            ...settings.tags,
                            [tagKey.trim()]: tagValue.trim(),
                          },
                        });
                        setTagKey("");
                        setTagValue("");
                      }}
                    >
                      {t("storage.add")}
                    </Button>
                  </div>
                  {Object.entries(settings.tags).map(([key, value]) => (
                    <div className="between" key={key}>
                      <span>
                        {key}: {value}
                      </span>
                      <Button
                        disabled={!canWrite(role)}
                        onClick={() => {
                          const tags = { ...settings.tags };
                          delete tags[key];
                          setSettings({ ...settings, tags });
                        }}
                      >
                        {t("common.delete")}
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="primary"
                    disabled={!canWrite(role) || busy}
                    onClick={() => void saveSettings()}
                  >
                    {t("common.save")}
                  </Button>
                </Panel>
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
                      header: t("storage.moreActions"),
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
            ) : tab === "s3-files" ? (
              <S3FilesPanel bucket={bucket} onBrowse={(targetPrefix) => {
                setPrefix(targetPrefix);
                setObjectSearch("");
                setObjectPage(1);
                setTab("objects");
              }} />
            ) : tab === "properties" ? (
              <div className="stack">
                <Panel title={t("storage.bucketDetails")}>
                  <KeyValues
                    items={[
                      ["ID", formatResourceId("obj", bucket.id)],
                      [t("common.name"), bucket.name],
                      [t("common.region"), t("common." + bucket.region)],
                      [
                        t("common.project"),
                        `${projectName(bucket.projectId)} · ${formatResourceId("prj", bucket.projectId || "")}`,
                      ],
                      [
                        t("storage.defaultClass"),
                        bucket.storageClass || "STANDARD",
                      ],
                      [t("storage.bucketLimit"), size(bucket.quotaGb)],
                      [t("storage.s3FilesTitle"), t(bucket.fileInterface ? "storage.s3FilesPreviewOnly" : "storage.s3FilesUnconfigured")],
                      [t("storage.s3FilesSource"), bucket.fileInterface ? `s3://${bucket.name}/${bucket.fileInterface.prefix}` : "—"],
                      [
                        t("storage.defaultEncryption"),
                        t(
                          bucket.defaultEncryption === false
                            ? "storage.disabled"
                            : "storage.enabled",
                        ),
                      ],
                      [
                        t("storage.versioning"),
                        t(
                          bucket.versioning
                            ? "storage.enabled"
                            : "storage.disabled",
                        ),
                      ],
                      [t("common.createdAt"), date(bucket.createdAt)],
                    ]}
                  />
                  <small>{t("storage.immutableProperties")}</small>
                </Panel>
                <Panel title={t("storage.tags")}>
                  <KeyValues
                    items={Object.entries(bucket.tags || {}).map(
                      ([key, value]) => [key, value],
                    )}
                  />
                  {!Object.keys(bucket.tags || {}).length && (
                    <small>{t("storage.noTags")}</small>
                  )}
                </Panel>
                {bucket.references[0] && (
                  <Link to={bucket.references[0].href}>
                    {t("storage.attached")}: {bucket.references[0].name}
                  </Link>
                )}
              </div>
            ) : tab === "permissions" ? (
              <div className="stack">
                <Panel title={t("storage.accessPolicy")}>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={settings.blockPublicAccess}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          blockPublicAccess: e.target.checked,
                          access: e.target.checked
                            ? "private"
                            : settings.access,
                        })
                      }
                    />
                    {t("storage.blockPublicAccess")}
                  </label>
                  <Field label={t("storage.accessPolicy")}>
                    <select
                      value={settings.access}
                      disabled={settings.blockPublicAccess}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          access: e.target.value as "private" | "public_read",
                        })
                      }
                    >
                      <option value="private">{t("common.private")}</option>
                      <option value="public_read">
                        {t("common.public_read")}
                      </option>
                    </select>
                  </Field>
                  <small>{t("storage.accessScopeHint")}</small>
                </Panel>
                <Panel title={t("storage.defaultEncryption")}>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={settings.defaultEncryption}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          defaultEncryption: e.target.checked,
                        })
                      }
                    />
                    {t("storage.encryptNewObjects")}
                  </label>
                  <small>{t("storage.encryptionScopeHint")}</small>
                </Panel>
                <Button
                  variant="primary"
                  disabled={!canWrite(role) || busy}
                  onClick={() => void saveSettings()}
                >
                  {t("common.save")}
                </Button>
              </div>
            ) : tab === "monitoring" ? (
              <div className="stack">
                <Panel title={t("storage.actualUsage")}>
                  <KeyValues
                    items={[
                      [t("storage.objects"), overview.data.objectCount],
                      [t("storage.actualUsage"), size(overview.data.usedGb)],
                      [t("storage.bucketLimit"), size(overview.data.quotaGb)],
                      [t("storage.measuredAt"), date(overview.data.measuredAt)],
                      [t("storage.requests"), t("storage.noUsageData")],
                    ]}
                  />
                </Panel>
              </div>
            ) : null}
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
            {q.data?.some((item) => item.name === name.trim()) && (
              <small className="field-error">
                {t("storage.duplicateBucket")}
              </small>
            )}
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
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>{t("storage.advancedConfig")}</summary>
            <div className="stack" style={{ paddingTop: 12 }}>
              <label className="row">
                <input
                  type="checkbox"
                  checked={createBlockPublic}
                  onChange={(e) => setCreateBlockPublic(e.target.checked)}
                />
                {t("storage.blockPublicAccess")}
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={createEncryption}
                  onChange={(e) => setCreateEncryption(e.target.checked)}
                />
                {t("storage.defaultEncryption")}
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={createVersioning}
                  onChange={(e) => setCreateVersioning(e.target.checked)}
                />
                {t("storage.versioning")}
              </label>
              <div className="form-grid">
                <Field label={t("storage.tagKey")}>
                  <input
                    className="input"
                    value={createTagKey}
                    onChange={(e) => setCreateTagKey(e.target.value)}
                  />
                </Field>
                <Field label={t("storage.tagValue")}>
                  <input
                    className="input"
                    value={createTagValue}
                    onChange={(e) => setCreateTagValue(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </details>
          <small>{t("storage.immutableProperties")}</small>
          <Button
            disabled={
              !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) ||
              !!q.data?.some((item) => item.name === name.trim()) ||
              busy ||
              quotaGb < 100 ||
              quotaGb > 1048500 ||
              quotaGb % 100 !== 0 ||
              !bucketProject ||
              (!!createTagKey.trim() && createTagKey.trim().length > 128) ||
              createTagValue.trim().length > 256 ||
              (!!createTagValue.trim() && !createTagKey.trim())
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
                    blockPublicAccess: createBlockPublic,
                    defaultEncryption: createEncryption,
                    versioning: createVersioning,
                    tags: createTagKey.trim()
                      ? { [createTagKey.trim()]: createTagValue.trim() }
                      : {},
                  }),
                "success.created",
              );
              if (b) {
                setNewOpen(false);
                setId(b.id);
                setTab("objects");
                setName("");
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
                [
                  t("storage.encryption"),
                  selected.encryption === "none"
                    ? t("storage.disabled")
                    : "SSE",
                ],
                [t("storage.versionId"), selected.versionId || "—"],
                [
                  t("storage.tags"),
                  Object.entries(selected.tags || {})
                    .map(([key, value]) => `${key}=${value}`)
                    .join(", ") || "—",
                ],
                [t("storage.metadata"), selected.contentType],
                [t("common.updatedAt"), date(selected.updatedAt)],
              ]}
            />
            {!!selected.previousVersions?.length && (
              <Panel title={t("storage.previousVersions")}>
                {selected.previousVersions.map((version) => (
                  <div className="between" key={version.versionId}>
                    <span>
                      {version.versionId.slice(0, 8)} ·{" "}
                      {date(version.updatedAt)} · {size(version.size / 1e9)}
                    </span>
                    <Button
                      onClick={() =>
                        void run(async () => {
                          const result = await api<{ url: string }>(
                            `${EP.buckets}/${id}/sign` +
                              query({
                                key: selected.key,
                                version_id: version.versionId,
                                expires,
                              }),
                          );
                          if (result.url.startsWith("data:")) {
                            const a = document.createElement("a");
                            a.href = result.url;
                            a.download =
                              selected.key.split("/").at(-1) || "object";
                            a.click();
                          }
                          return result;
                        })
                      }
                    >
                      {t("common.download")}
                    </Button>
                  </div>
                ))}
              </Panel>
            )}
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
              <Button onClick={() => void copy(selected.key)}>
                {t("storage.copyKey")}
              </Button>
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
                      t("storage.deleteObjectConfirm") + " " + selected.key,
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
