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
  const valid =
    scalingSchema.safeParse(config).success &&
    (kind === "inference" || config.min_size >= 1) &&
    (kind !== "gpu_baremetal" ||
      (config.cooldown_s >= 600 && config.cooldown_s <= 1800));
  const changeSummary = Object.entries(config)
    .filter(
      ([key, value]) =>
        !editing || value !== editing.config[key as keyof ScalingConfig],
    )
    .map(([key, value]) => ({
      key,
      before: editing
        ? String(editing.config[key as keyof ScalingConfig])
        : "—",
      after: String(value),
    }));
  return (
    <>
      <PageHeader
        title={t("nav.scaling")}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={() => {
              setEditing(null);
              setResource("");
              setConfig(defaultScaling(kind));
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
        items={KINDS.map((k) => ({
          id: k,
          label: `${t("common." + k)} (${policies.data?.filter((p) => typeOf(p.resourceUuid) === k).length || 0})`,
        }))}
        value={kind}
        onChange={(k) => {
          setKind(k as Kind);
          setConfig(defaultScaling(k as Kind));
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
                setConfig(structuredClone(p.config));
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
      </div>
      <Modal
        drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t("nav.scaling")}
      >
        <div className="stack">
          <Field label={t("nav.resources")}>
            <select
              disabled={!!editing}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">{t("nav.resources")}</option>
              {(editing
                ? rs.filter((r) => r.resourceUuid === editing.resourceUuid)
                : available
              ).map((r) => (
                <option key={r.resourceUuid} value={r.resourceUuid}>
                  {dt(r.name)} · {r.displayId}
                </option>
              ))}
            </select>
          </Field>
          {target && (
            <Link to={resourceLink(target)}>{t("common.details")}</Link>
          )}
          <ScalingFields kind={kind} full value={config} onChange={setConfig} />
          {kind === "vgpu" && (
            <div className="notice">
              {t("resource.slicing")} ·{" "}
              {target?.kind === "vgpu"
                ? target.spec.nodePools.map((p) => p.migProfile).join(", ")
                : "—"}
            </div>
          )}
          <Panel title={t("scaling.changeSummary")}>
            <DataTable
              data={changeSummary}
              columns={[
                { accessorKey: "key", header: t("common.name") },
                { accessorKey: "before", header: t("common.before") },
                { accessorKey: "after", header: t("common.after") },
              ]}
            />
          </Panel>
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
