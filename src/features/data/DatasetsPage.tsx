import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Dataset } from "../../types/domain";
import { EP, query, post, remove } from "../../lib/api-client";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData, useDebounced } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { t, dt } from "../../i18n";
import { date } from "../../lib/date";
import { size } from "../../lib/money";
import {
  PageHeader,
  Button,
  Panel,
  DataTable,
  Modal,
  Tabs,
  Field,
  Loading,
  ErrorState,
  Empty,
  KeyValues,
} from "../../components/ui";
export default function DatasetsPage() {
  const [search, setSearch] = useUrlState("q");
  const debounced = useDebounced(search);
  const [format, setFormat] = useUrlState("format");
  const [minSize, setMinSize] = useUrlState("min_gb");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadFormat, setUploadFormat] = useState("jsonl");
  const { id, setId } = useDrawer();
  const [tab, setTab] = useState("overview");
  const [version, setVersion] = useState("");
  const [versionSize, setVersionSize] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const role = useAuth((s) => s.role);
  const q = useData<Dataset[]>(
    ["datasets", format],
    EP.datasets + query({ format }),
  );
  const detail = useData<Dataset>(["dataset", id], `${EP.datasets}/${id}`, {
    enabled: !!id,
  });
  const { run, busy } = useAction();
  const filtered =
    q.data?.filter(
      (d) =>
        dt(d.name).toLowerCase().includes(debounced.toLowerCase()) &&
        (!minSize || d.size_gb >= Number(minSize)),
    ) || [];
  const d = detail.data;
  return (
    <>
      <PageHeader
        title={t("nav.datasets")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => setOpen(true)}
          >
            {t("datasets.new")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter org />
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label={t("common.format")}
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="">{t("common.format")}</option>
          {["parquet", "jsonl", "image"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <input
          aria-label={t("common.size")}
          className="input"
          type="number"
          min={0}
          placeholder="GB ≥"
          value={minSize}
          onChange={(e) => setMinSize(e.target.value)}
        />
      </div>
      <div className="panel">
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <DataTable
            data={filtered}
            onRow={(d) => {
              setTab("overview");
              setId(d.id);
            }}
            columns={[
              {
                accessorKey: "name",
                header: t("common.name"),
                cell: ({ row }) => dt(row.original.name),
              },
              { accessorKey: "latest_version", header: t("common.version") },
              {
                accessorKey: "size_gb",
                header: t("common.size"),
                cell: ({ row }) => size(row.original.size_gb),
              },
              { accessorKey: "format_tag", header: t("common.format") },
              {
                accessorKey: "updatedAt",
                header: t("common.updatedAt"),
                cell: ({ row }) => date(row.original.updatedAt),
              },
              {
                id: "references",
                header: t("common.reference"),
                cell: ({ row }) => row.original.references.length,
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
          setError(null);
        }}
        title={d ? dt(d.name) : t("nav.datasets")}
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState error={detail.error} />
        ) : d ? (
          <div className="stack">
            <div className="row">
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      t("common.delete") + " " + dt(d.name),
                    ))
                  )
                    return;
                  setError(null);
                  try {
                    await remove(`${EP.datasets}/${id}`);
                    setId("");
                    await q.refetch();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
            {!!error && <ErrorState error={error} />}
            <Tabs
              items={["overview", "versions", "preview", "references"].map(
                (id) => ({
                  id,
                  label: t(
                    id === "overview" ? "tab.overview" : "datasets." + id,
                  ),
                }),
              )}
              value={tab}
              onChange={setTab}
            />
            {tab === "overview" ? (
              <Panel title={t("tab.overview")}>
                <KeyValues
                  items={[
                    [t("common.name"), dt(d.name)],
                    [t("common.version"), d.latest_version],
                    [t("common.size"), size(d.size_gb)],
                    [t("common.format"), d.format_tag],
                    [t("common.createdAt"), date(d.createdAt)],
                    [t("common.updatedAt"), date(d.updatedAt)],
                  ]}
                />
              </Panel>
            ) : tab === "versions" ? (
              <div className="stack">
                <DataTable
                  data={d.versions}
                  columns={[
                    { accessorKey: "version", header: t("common.version") },
                    {
                      accessorKey: "size_gb",
                      header: t("common.size"),
                      cell: ({ row }) => size(row.original.size_gb),
                    },
                    { accessorKey: "note", header: t("datasets.versionNote") },
                  ]}
                />
                <Panel title={t("common.create")}>
                  <div className="form-grid">
                    <Field label={t("common.version")}>
                      <input
                        className="input"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                      />
                    </Field>
                    <Field label={t("common.size") + " · GB"}>
                      <input
                        className="input"
                        type="number"
                        min={0.00001}
                        value={versionSize}
                        onChange={(e) => setVersionSize(Number(e.target.value))}
                      />
                    </Field>
                    <Field label={t("datasets.versionNote")}>
                      <input
                        className="input"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </Field>
                    <Button
                      disabled={
                        !canWrite(role) || !version || versionSize <= 0 || busy
                      }
                      onClick={() =>
                        void run(() =>
                          post(`${EP.datasets}/${id}/versions`, {
                            version,
                            size_gb: versionSize,
                            note,
                          }),
                        )
                      }
                    >
                      {t("common.create")}
                    </Button>
                  </div>
                </Panel>
              </div>
            ) : tab === "preview" ? (
              <Panel title={t("datasets.preview")}>
                {d.preview.length ? (
                  d.format_tag === "image" ? (
                    <div className="image-preview">
                      {d.preview.map((item, i) => (
                        <div key={i}>
                          {typeof item.thumbnail === "string" ? (
                            <img
                              src={item.thumbnail}
                              alt={String(item.label)}
                              style={{ width: "100%", borderRadius: 6 }}
                            />
                          ) : (
                            <svg
                              viewBox="0 0 160 120"
                              role="img"
                              aria-label={String(item.label)}
                            >
                              <rect
                                width="160"
                                height="120"
                                fill="var(--rs-surface-2)"
                              />
                              <path
                                d="M0 120L60 35L100 90L130 60L160 120"
                                fill="var(--rs-info)"
                                opacity={0.25}
                              />
                              <circle
                                cx={120 - (i % 4) * 15}
                                cy={25}
                                r={12}
                                fill="var(--rs-gold)"
                              />
                            </svg>
                          )}
                          <small>{String(item.label)}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <DataTable
                      data={d.preview.slice(0, 50)}
                      columns={Object.keys(d.preview[0]).map((key) => ({
                        accessorKey: key,
                        header: key,
                      }))}
                    />
                  )
                ) : (
                  <Empty />
                )}
              </Panel>
            ) : (
              <Panel title={t("datasets.references")}>
                {d.references.length ? (
                  <div className="stack">
                    {d.references.map((ref) => (
                      <Link key={ref.id} to={ref.href}>
                        {dt(ref.name)}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
              </Panel>
            )}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("datasets.new")}
      >
        <div className="stack">
          <Field label={t("common.name")}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t("common.format")}>
            <select
              value={uploadFormat}
              onChange={(e) => setUploadFormat(e.target.value)}
            >
              {["parquet", "jsonl", "image"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label={t("common.upload")}>
            <input
              type="file"
              accept={
                uploadFormat === "jsonl"
                  ? ".jsonl,.json"
                  : uploadFormat === "parquet"
                    ? ".parquet"
                    : "image/*"
              }
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!canWrite(role) || name.length < 2 || !file || busy}
            onClick={async () => {
              if (!file) return;
              let preview: Record<string, string | number>[] = [];
              if (uploadFormat === "jsonl") {
                try {
                  preview = (await file.text())
                    .split("\n")
                    .filter(Boolean)
                    .slice(0, 50)
                    .map(
                      (line) =>
                        JSON.parse(line) as Record<string, string | number>,
                    );
                } catch {
                  setError(new Error("INVALID_FILE"));
                  return;
                }
              }
              const result = await run(
                () =>
                  post<Dataset>(EP.datasets, {
                    name,
                    size_gb: file.size / 1e9,
                    format_tag: uploadFormat,
                    preview,
                  }),
                "success.created",
              );
              if (result) {
                setOpen(false);
                setId(result.id);
              }
            }}
          >
            {t("common.upload")}
          </Button>
          {!!error && <ErrorState error={error} />}
        </div>
      </Modal>
    </>
  );
}
