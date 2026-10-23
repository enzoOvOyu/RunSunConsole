import { useUrlState } from "../../shared/useUrlState";
import { useResourceTransition } from "../../../stores/resourceTransition";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Columns3 } from "lucide-react";
import {
  REGIONS,
  type Kind,
  type Resource,
  type Project,
  type Status,
} from "../../../types/domain";
import { useRegion } from "../../../stores/region";
import { useAuth } from "../../../stores/auth";
import { canWrite } from "../../../lib/rbac";
import { KIND_META, formatResourceId, resourceLink } from "../../../lib/ids";
import { EP, post, remove, query } from "../../../lib/api-client";
import { useAction, useData, useDebounced } from "../../shared/hooks";
import { t, dt, errorText } from "../../../i18n";
import {
  Button,
  Badge,
  PageHeader,
  DataTable,
  Empty,
  Loading,
  ErrorState,
  Modal,
  Check,
  Field,
  toast,
} from "../../../components/ui";
import { Checkbox } from "../../../components/ui/checkbox";
import { ResourceDrawer } from "./ResourceDrawer";
export function ResourceName({ resource: r }: { resource: Resource }) {
  return (
    <div>
      <strong style={{ fontWeight: 500 }}>{dt(r.name)}</strong>
      <div>
        <small className="resource-id">{r.displayId}</small>
      </div>
    </div>
  );
}
export type ResourceFacet<K extends Kind> = {
  id: string;
  label: string;
  value: (resource: Extract<Resource, { kind: K }>) => string;
  format?: (value: string) => string;
};
export function ResourceListShell<K extends Kind>({
  kind,
  columns,
  facets = [],
}: {
  kind: K;
  columns: ColumnDef<Extract<Resource, { kind: K }>>[];
  facets?: ResourceFacet<K>[];
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { region, setRegion } = useRegion();
  const { setProject, role } = useAuth();
  const [search, setSearch] = useUrlState("q");
  const q = useDebounced(search);
  const urlRegion = params.get("region");
  const urlProject = params.get("project_id");
  useEffect(() => {
    if (REGIONS.includes(urlRegion as typeof region))
      setRegion(urlRegion as typeof region);
  }, [urlRegion, setRegion]);
  const projects = useData<Project[]>(
    ["projects", region],
    EP.projects + query({ region }),
  );
  const project = projects.data?.some((item) => item.id === urlProject && !item.deletedAt)
    ? urlProject || ""
    : "";
  useEffect(() => {
    setProject(project);
  }, [project, setProject]);
  useEffect(() => {
    if (!projects.data || !urlProject || project) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("project_id");
      return next;
    }, { replace: true });
  }, [projects.data, urlProject, project, setParams]);
  const [released, setReleased] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [deleteMany, setDeleteMany] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [facetValues, setFacetValues] = useState<Record<string, string>>({});
  const action = useAction();
  const client = useQueryClient();
  const status = params.get("status") || "";
  const resources = useData<{
    items: Extract<Resource, { kind: K }>[];
    total: number;
  }>(
    ["resources", kind, region, project, status, q, released],
    EP.resources +
      query({
        kind,
        region,
        project_id: project,
        status,
        q,
        includeDeleted: released,
        size: 1000,
      }),
    { poll: true, enabled: !urlProject || !!projects.data },
  );
  useEffect(() => {
    setSelected([]);
    setFacetValues({});
    setPage(0);
  }, [kind, region, project]);
  useEffect(() => {
    setSelected([]);
    setPage(0);
  }, [status, q]);
  const transition = useResourceTransition((s) => s.items);
  const items = useMemo(() => {
    const fetched = resources.data?.items || [];
    const fetchedIds = new Set(fetched.map((resource) => resource.resourceUuid));
    const pending = transition.filter((resource) =>
      resource.kind === kind && resource.region === region && (!project || resource.projectId === project) && !fetchedIds.has(resource.resourceUuid)
    ) as Extract<Resource, { kind: K }>[];
    return [...fetched, ...pending];
  }, [resources.data?.items, transition, kind, region, project]);
  const shown = useMemo(() => items.filter((resource) =>
    facets.every((facet) => !facetValues[facet.id] || facet.value(resource) === facetValues[facet.id])
  ), [items, facets, facetValues]);
  const hasFacetFilter = Object.values(facetValues).some(Boolean);
  const pageCount =
    pageSize === 0 ? 1 : Math.max(1, Math.ceil(shown.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const pageResources = useMemo(
    () =>
      pageSize === 0
        ? shown
        : shown.slice(activePage * pageSize, (activePage + 1) * pageSize),
    [activePage, pageSize, shown],
  );
  const pageIds = pageResources.map((resource) => resource.resourceUuid);
  const chosen = shown.filter((r) => selected.includes(r.resourceUuid));
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const checkbox: ColumnDef<Extract<Resource, { kind: K }>> = {
    id: "select",
    enableSorting: false,
    header: () => (
      <Checkbox
        aria-label={t("resource.selectPage")}
        checked={
          pageIds.length > 0 && pageIds.every((id) => selected.includes(id))
            ? true
            : pageIds.some((id) => selected.includes(id))
              ? "indeterminate"
              : false
        }
        onCheckedChange={(checked) =>
          setSelected((current) => {
            const pageSet = new Set<string>(pageIds);
            const withoutPage = current.filter((id) => !pageSet.has(id));
            return checked === true
              ? [...withoutPage, ...pageIds]
              : withoutPage;
          })
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={row.original.displayId}
        checked={selected.includes(row.original.resourceUuid)}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={() => toggle(row.original.resourceUuid)}
      />
    ),
  };
  const visibleCols = columns.filter((_, i) => !hidden.includes(String(i)));
  const batch = async (op: "start" | "stop" | "delete") => {
    if (chosen.length > 20) {
      toast(t("resource.batchLimit"), true);
      return;
    }
    for (const r of chosen) {
      try {
        if (op === "delete")
          await remove(
            `${EP.resources}/${r.resourceUuid}${query({ confirm: r.displayId })}`,
          );
        else await post(`${EP.resources}/${r.resourceUuid}/${op}`, {});
      } catch (error) {
        toast(`${r.displayId}: ${errorText(error)}`, true);
      }
    }
    setSelected([]);
    setDeleteMany(false);
    setConfirm("");
    await client.invalidateQueries();
  };
  return (
    <>
      <PageHeader
        title={
          <span className="row">
            {t(`common.${kind}`)}{" "}
            <span className="chip">
              {resources.isPending
                ? "—"
                : hasFacetFilter
                  ? shown.length
                  : (resources.data?.total ?? "—")}
            </span>
          </span>
        }
        subtitle={t(`pageDescription.resources.${kind}`)}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => navigate(`/deployment/${KIND_META[kind].deployKey}`)}
          >
            <Plus size={15} />
            {t("common.create")}
          </Button>
        }
      />
      <div className="toolbar">
        <select
          aria-label={t("common.region")}
          value={region}
          onChange={(e) => {
            setRegion(e.target.value as typeof region);
            setProject("");
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.set("region", e.target.value);
                next.delete("project_id");
                return next;
              },
              { replace: true },
            );
          }}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {t(`common.${r}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("common.project")}
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                next.set("project_id", e.target.value);
                return next;
              },
              { replace: true },
            );
          }}
        >
          <option value="">{t("common.allProjects")}</option>
          {projects.data?.filter((p) => !p.deletedAt).map((p) => (
            <option key={p.id} value={p.id}>
              {dt(p.name)} · {formatResourceId("prj", p.id)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("common.status")}
          value={status}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set("status", e.target.value);
            else p.delete("status");
            setParams(p);
          }}
        >
          <option value="">{t("common.all")}</option>
          {(["running", "stopped", "provisioning", "error"] as Status[]).map(
            (s) => (
              <option key={s} value={s}>
                {t(`common.${s}`)}
              </option>
            ),
          )}
        </select>
        {facets.map((facet) => (
          <select
            key={facet.id}
            aria-label={facet.label}
            value={facetValues[facet.id] || ""}
            onChange={(event) => {
              setSelected([]);
              setPage(0);
              setFacetValues((current) => ({
                ...current,
                [facet.id]: event.target.value,
              }));
            }}
          >
            <option value="">
              {facet.label} · {t("common.all")}
            </option>
            {[...new Set(items.map(facet.value))].sort().map((value) => (
              <option key={value} value={value}>
                {facet.format ? facet.format(value) : value}
              </option>
            ))}
          </select>
        ))}
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button onClick={() => setShowColumns(true)}>
          <Columns3 size={14} />
          {t("resource.columns")}
        </Button>
        <Check
          label={t("resource.released")}
          checked={released}
          onChange={setReleased}
        />
      </div>
      {selected.length > 0 && (
        <div className="notice row" style={{ marginBottom: 16 }}>
          {t("common.selected", { count: selected.length })}
          <Button
            disabled={!canWrite(role) || action.busy}
            onClick={() => void batch("start")}
          >
            {t("resource.start")}
          </Button>
          <Button
            disabled={!canWrite(role) || action.busy}
            onClick={() => void batch("stop")}
          >
            {t("resource.stop")}
          </Button>
          <Button
            variant="danger"
            disabled={!canWrite(role)}
            onClick={() => setDeleteMany(true)}
          >
            {t("common.delete")}
          </Button>
        </div>
      )}
      <div className="panel">
        {resources.isPending ? (
          <Loading />
        ) : resources.error ? (
          <ErrorState
            error={resources.error}
            retry={() => void resources.refetch()}
          />
        ) : !items.length && !q && !status && !hasFacetFilter ? (
          <Empty
            text={t("overview.noResources")}
            action={
              <Button
                onClick={() =>
                  navigate(`/deployment/${KIND_META[kind].deployKey}`)
                }
              >
                {t("common.create")}
              </Button>
            }
          />
        ) : !shown.length ? (
          <Empty text={t("resource.noMatchingSpecs")} />
        ) : (
          <>
            <DataTable
              data={pageResources}
              columns={[checkbox, ...visibleCols]}
              onRow={(r) => navigate(resourceLink(r))}
              paginate={false}
            />
            <div className="table-footer resource-pagination">
              <div className="row">
                <span>{t("common.rows", { count: shown.length })}</span>
                <label className="row resource-page-size">
                  <span>{t("resource.pageSize")}</span>
                  <select
                    aria-label={t("resource.pageSize")}
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(0);
                    }}
                  >
                    {[10, 25, 50].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                    <option value={0}>{t("common.all")}</option>
                  </select>
                </label>
              </div>
              <div className="row">
                <Button
                  aria-label={t("resource.previousPage")}
                  disabled={activePage === 0}
                  onClick={() => setPage(activePage - 1)}
                >
                  {t("resource.previousPage")}
                </Button>
                <span>
                  {t("common.page", { page: activePage + 1 })} / {pageCount}
                </span>
                <Button
                  aria-label={t("resource.nextPage")}
                  disabled={activePage + 1 >= pageCount}
                  onClick={() => setPage(activePage + 1)}
                >
                  {t("resource.nextPage")}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      <ResourceDrawer />
      <Modal
        open={showColumns}
        onClose={() => setShowColumns(false)}
        title={t("resource.columns")}
      >
        <div className="stack">
          {columns.map((col, i) => (
            <Check
              key={i}
              label={
                typeof col.header === "string"
                  ? col.header
                  : String(col.id || i)
              }
              checked={!hidden.includes(String(i))}
              onChange={(checked) =>
                setHidden(
                  checked
                    ? hidden.filter((x) => x !== String(i))
                    : [...hidden, String(i)],
                )
              }
            />
          ))}
        </div>
      </Modal>
      <Modal
        open={deleteMany}
        onClose={() => setDeleteMany(false)}
        title={t("resource.deleteTitle")}
        description={t("resource.deleteImpact")}
      >
        <div className="stack">
          {chosen.map((r) => (
            <div className="row" key={r.resourceUuid}>
              <code className="resource-id">{r.displayId}</code>
              <Badge status={r.status} />
            </div>
          ))}
          <Field
            label={t("resource.deleteInput", {
              id: chosen.map((r) => r.displayId).join(","),
            })}
          >
            <input
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button
            variant="danger"
            disabled={confirm !== chosen.map((r) => r.displayId).join(",")}
            onClick={() => void batch("delete")}
          >
            {t("common.delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
