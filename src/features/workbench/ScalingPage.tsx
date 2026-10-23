import { useUrlState } from "../shared/useUrlState";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  KINDS,
  type Kind,
  type Resource,
  type ScalingConfig,
  type ScalingPolicy,
  type ScalingEvent,
  type ResourceEvent,
} from "../../types/domain";
import { EP, query, post, patch, remove } from "../../lib/api-client";
import { defaultScaling } from "../../lib/config";
import { scalingSchema } from "../../lib/schema";
import { resourceLink } from "../../lib/ids";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData } from "../shared/hooks";
import { RegionFilter } from "../shared/RegionFilter";
import { ScalingFields } from "../deployment/shared/fields";
import { t, dt } from "../../i18n";
import { date, duration } from "../../lib/date";
import {
  PageHeader,
  Button,
  Tabs,
  Panel,
  Modal,
  Field,
  DataTable,
  Badge,
  Empty,
  Loading,
  ErrorState,
} from "../../components/ui";
export default function ScalingPage() {
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const [kind, setKind] = useState<Kind>("gpu_vm");
  const [editing, setEditing] = useState<ScalingPolicy | null>(null);
  const [open, setOpen] = useState(false);
  const [resource, setResource] = useState("");
  const [config, setConfig] = useState<ScalingConfig>(defaultScaling(kind));
  const [configNotice, setConfigNotice] = useState("");
  const [direction, setDirection] = useUrlState("direction");
  const policies = useData<ScalingPolicy[]>(
    ["policies", region],
    EP.policies + query({ region }),
    { poll: true },
  );
  const resources = useData<{ items: Resource[] }>(
    ["scaling-resources", region],
    EP.resources + query({ region, size: 1000 }),
    { poll: true },
  );
  const events = useData<ScalingEvent[]>(
    ["scaling-events", region, direction],
    EP.scalingEvents + query({ region, direction }),
    { poll: true },
  );
  const changes = useData<ResourceEvent[]>(
    ["scaling-changes", region],
    EP.scalingChanges + query({ region }),
    { poll: true },
  );
  const { run, busy } = useAction();
  const rs = resources.data?.items || [];
  const typeOf = (id: string) => rs.find((r) => r.resourceUuid === id)?.kind;
  const rows =
    policies.data?.filter((p) => typeOf(p.resourceUuid) === kind) || [];
  const available = rs.filter(
    (r) =>
      r.kind === kind &&
      !policies.data?.some((p) => p.resourceUuid === r.resourceUuid),
  );
  const target = rs.find((r) => r.resourceUuid === resource);
  const targetSize = target
    ? "quantity" in target.spec
      ? target.spec.quantity
      : "machineCount" in target.spec
        ? target.spec.machineCount
        : "nodePools" in target.spec
          ? target.spec.nodePools.reduce((sum, item) => sum + item.nodeCount, 0)
          : target.spec.replicas
    : null;
  const valid =
    scalingSchema.safeParse(config).success &&
    (targetSize === null ||
      (config.min_size <= targetSize && targetSize <= config.max_size)) &&
    (kind === "inference" || config.min_size >= 1) &&
    (kind !== "gpu_baremetal" ||
      (config.cooldown_s >= 600 && config.cooldown_s <= 1800));
  const fieldNames: Record<string, string> = {
    trigger_metric: t("common.metric"),
    target_value: t("scaling.targetValue"),
    min_size: t("scaling.minSize"),
    max_size: t("scaling.maxSize"),
    scale_to_zero: t("scaling.zero"),
    drain_timeout_s: t("scaling.drain"),
    fallback_enabled: t("scaling.fallback"),
    cooldown_s: t("scaling.cooldown"),
    warm_pool: t("scaling.warmPool"),
    weight_cache: t("scaling.cache"),
    canary_percent: t("wizard.canary"),
    maintenance_window: t("scaling.maintenance"),
  };
  const changeSummary = Object.entries(config)
    .filter(
      ([key, value]) =>
        !editing || value !== editing.config[key as keyof ScalingConfig],
    )
    .map(([key, value]) => ({
      key: fieldNames[key] || key,
      before: editing
        ? String(editing.config[key as keyof ScalingConfig])
        : "—",
      after: String(value),
    }));
  const changeDescription = (event: ResourceEvent) => {
    if (event.type === "scaling_policy_created")
      return t("scaling.changeCreated");
    if (event.type === "scaling_policy_deleted")
      return t("scaling.changeDeleted");
    if (event.type === "scaling_policy_paused")
      return t("scaling.changePaused");
    if (event.type === "scaling_policy_resumed")
      return t("scaling.changeResumed");
    try {
      const previous = JSON.parse(event.before) as Record<string, unknown>;
      const next = JSON.parse(event.after) as Record<string, unknown>;
      const before = (previous.config || previous) as Record<string, unknown>;
      const after = (next.config || next) as Record<string, unknown>;
      const previousStatus = previous.status as string | undefined;
      const nextStatus = next.status as string | undefined;
      const changed = Object.keys(after).filter(
        (key) => before[key] !== after[key],
      );
      if (previousStatus !== nextStatus && nextStatus) changed.push("status");
      return changed.length
        ? changed
            .map(
              (key) =>
                `${fieldNames[key] || t("common.status")}: ${String(before[key] ?? previousStatus ?? "—")} → ${String(after[key] ?? nextStatus ?? "—")}`,
            )
            .join(" · ")
        : t("scaling.changeNoDetails");
    } catch {
      return `${event.before} → ${event.after}`;
    }
  };
  return (
    <>
      <PageHeader
        title={t("nav.scaling")}
        subtitle={t("pageDescription.scaling")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => {
              setEditing(null);
              setResource("");
              setConfig(defaultScaling(kind));
              setConfigNotice("");
              setOpen(true);
            }}
          >
            {t("common.create")}
          </Button>
        }
      />
      <div className="toolbar">
        <RegionFilter />
      </div>
      <Tabs
        className="tall-tabs"
        items={KINDS.map((k) => ({
          id: k,
          label: `${t("common." + k)} (${policies.data?.filter((p) => typeOf(p.resourceUuid) === k).length || 0})`,
        }))}
        value={kind}
        onChange={(k) => {
          setKind(k as Kind);
          setConfig(defaultScaling(k as Kind));
          setConfigNotice("");
        }}
      />
      <div className="notice warning" style={{ marginBottom: 20 }}>
        {t("scaling." + kind)}
      </div>
      <div className="stack">
        <Panel
          title={t(
            "scaling." + (kind === "inference" ? "replica" : "node_pool"),
          )}
        >
          {policies.isPending ? (
            <Loading />
          ) : policies.error ? (
            <ErrorState error={policies.error} />
          ) : rows.length ? (
            <DataTable
              data={rows}
              onRow={(p) => {
                setEditing(p);
                setResource(p.resourceUuid);
                const linked = rs.find(
                  (item) => item.resourceUuid === p.resourceUuid,
                );
                const actual = linked
                  ? "quantity" in linked.spec
                    ? linked.spec.quantity
                    : "machineCount" in linked.spec
                      ? linked.spec.machineCount
                      : "nodePools" in linked.spec
                        ? linked.spec.nodePools.reduce(
                            (sum, item) => sum + item.nodeCount,
                            0,
                          )
                        : linked.spec.replicas
                  : p.config.min_size;
                const adjusted = structuredClone(p.config);
                if (actual < adjusted.min_size || actual > adjusted.max_size) {
                  adjusted.min_size = Math.min(adjusted.min_size, actual);
                  adjusted.max_size = Math.max(adjusted.max_size, actual);
                  setConfigNotice(t("scaling.rangeAdjusted", { actual }));
                } else setConfigNotice("");
                setConfig(adjusted);
                setOpen(true);
              }}
              columns={[
                { accessorKey: "name", header: t("common.name") },
                {
                  id: "resource",
                  header: t("nav.resources"),
                  cell: ({ row }) =>
                    rs.find((r) => r.resourceUuid === row.original.resourceUuid)
                      ?.displayId,
                },
                {
                  id: "trigger",
                  header: t("common.metric"),
                  cell: ({ row }) =>
                    t("scaling." + row.original.config.trigger_metric),
                },
                {
                  id: "range",
                  header: t("common.count"),
                  cell: ({ row }) =>
                    `${row.original.config.min_size}–${row.original.config.max_size}`,
                },
                {
                  accessorKey: "status",
                  header: t("common.status"),
                  cell: ({ row }) => <Badge status={row.original.status} />,
                },
                {
                  accessorKey: "updatedAt",
                  header: t("common.updatedAt"),
                  cell: ({ row }) => date(row.original.updatedAt),
                },
                {
                  id: "actions",
                  header: t("common.actions"),
                  cell: ({ row }) => (
                    <Button
                      disabled={!canWrite(role) || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void run(() =>
                          patch(EP.policies + "/" + row.original.id, {
                            status:
                              row.original.status === "paused"
                                ? "active"
                                : "paused",
                          }),
                        );
                      }}
                    >
                      {t(
                        row.original.status === "paused"
                          ? "scaling.resume"
                          : "scaling.pause",
                      )}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <Empty text={t("scaling.empty")} />
          )}
        </Panel>
        <Panel
          title={t("scaling.events")}
          action={
            <select
              aria-label={t("common.filter")}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="">{t("common.all")}</option>
              {["scale_out", "scale_in"].map((d) => (
                <option key={d} value={d}>
                  {t("scaling." + d)}
                </option>
              ))}
            </select>
          }
        >
          <DataTable
            data={(events.data || []).filter(
              (e) => typeOf(e.resourceUuid) === kind,
            )}
            columns={[
              {
                accessorKey: "at",
                header: t("common.time"),
                cell: ({ row }) => date(row.original.at),
              },
              {
                accessorKey: "direction",
                header: t("common.type"),
                cell: ({ row }) => t("scaling." + row.original.direction),
              },
              {
                id: "change",
                header: t("common.count"),
                cell: ({ row }) => `${row.original.from} → ${row.original.to}`,
              },
              {
                id: "metric",
                header: t("common.metric"),
                cell: ({ row }) =>
                  `${t("scaling." + row.original.metric)}: ${row.original.value} / ${row.original.threshold}`,
              },
              {
                accessorKey: "durationS",
                header: t("common.duration"),
                cell: ({ row }) => duration(row.original.durationS),
              },
            ]}
          />
        </Panel>
        <Panel title={t("scaling.changeHistory")}>
          {changes.isPending ? (
            <Loading />
          ) : changes.error ? (
            <ErrorState error={changes.error} />
          ) : (
            <DataTable
              data={(changes.data || []).filter((event) =>
                rs.some(
                  (item) =>
                    item.resourceUuid === event.resourceUuid &&
                    item.kind === kind,
                ),
              )}
              columns={[
                {
                  accessorKey: "at",
                  header: t("common.time"),
                  cell: ({ row }) => date(row.original.at),
                },
                {
                  id: "resource",
                  header: t("nav.resources"),
                  cell: ({ row }) => {
                    const linked = rs.find(
                      (item) => item.resourceUuid === row.original.resourceUuid,
                    );
                    return linked ? (
                      <Link to={resourceLink(linked)}>
                        {dt(linked.name)} · {linked.displayId}
                      </Link>
                    ) : (
                      "—"
                    );
                  },
                },
                {
                  accessorKey: "type",
                  header: t("common.type"),
                  cell: ({ row }) => t(`scaling.${row.original.type}`),
                },
                {
                  id: "change",
                  header: t("scaling.changeInfo"),
                  cell: ({ row }) => changeDescription(row.original),
                },
              ]}
            />
          )}
        </Panel>
      </div>
      <Modal
        drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t("nav.scaling")}
      >
        <div className="stack">
          {editing ? (
            <Field label={t("scaling.resource")}>
              {target ? (
                <Link className="mono" to={resourceLink(target)}>
                  {target.displayId}
                </Link>
              ) : (
                <span className="mono">{editing.resourceUuid}</span>
              )}
            </Field>
          ) : (
            <Field label={t("scaling.resource")}>
              <select
                value={resource}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setResource(nextId);
                  const selected = rs.find(
                    (item) => item.resourceUuid === nextId,
                  );
                  if (selected) {
                    const actual =
                      "quantity" in selected.spec
                        ? selected.spec.quantity
                        : "machineCount" in selected.spec
                          ? selected.spec.machineCount
                          : "nodePools" in selected.spec
                            ? selected.spec.nodePools.reduce(
                                (sum, item) => sum + item.nodeCount,
                                0,
                              )
                            : selected.spec.replicas;
                    setConfig((current) => ({
                      ...current,
                      min_size: actual,
                      max_size: Math.min(
                        kind === "inference" || kind === "gpu_baremetal"
                          ? 32
                          : 64,
                        Math.max(actual, actual * 2),
                      ),
                    }));
                  }
                }}
              >
                <option value="">{t("nav.resources")}</option>
                {available.map((r) => (
                  <option key={r.resourceUuid} value={r.resourceUuid}>
                    {dt(r.name)} · {r.displayId}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {configNotice && <p className="notice">{configNotice}</p>}
          <ScalingFields kind={kind} full value={config} onChange={setConfig} />
          {kind === "vgpu" && (
            <div className="notice">
              {t("resource.slicing")} ·{" "}
              {target?.kind === "vgpu"
                ? target.spec.nodePools.map((p) => p.migProfile).join(", ")
                : "—"}
            </div>
          )}
          <Panel title={t("scaling.changeInfo")}>
            <DataTable
              data={changeSummary}
              columns={[
                { accessorKey: "key", header: t("common.name") },
                { accessorKey: "before", header: t("common.before") },
                { accessorKey: "after", header: t("common.after") },
              ]}
            />
          </Panel>
          {targetSize !== null &&
            (targetSize < config.min_size || targetSize > config.max_size) && (
              <div className="field-error">
                {t("scaling.rangeMustIncludeCurrent", { actual: targetSize })}
              </div>
            )}
          {!valid && <div className="field-error">{t("wizard.invalid")}</div>}
          <div className="row">
            <Button
              variant="primary"
              disabled={!valid || !resource || !canWrite(role) || busy}
              onClick={async () => {
                const result = await run(() =>
                  editing
                    ? patch(EP.policies + "/" + editing.id, { config })
                    : post(EP.policies, { resourceUuid: resource, config }),
                );
                if (result) setOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
            {editing && (
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      t("common.delete") + " " + editing.name,
                    ))
                  )
                    return;
                  const result = await run(async () => {
                    await remove(EP.policies + "/" + editing.id);
                    return true;
                  }, "success.deleted");
                  if (result) setOpen(false);
                }}
              >
                {t("common.delete")}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
