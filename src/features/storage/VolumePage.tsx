import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import type { StorageProduct, StorageVolume } from "../../types/storage";
import type { Kind, Project, Quota } from "../../types/domain";
import { EP, post, query, remove } from "../../lib/api-client";
import { resourceLink } from "../../lib/ids";
import { useRegion } from "../../stores/region";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { useAction, useData } from "../shared/hooks";
import { useDrawer } from "../shared/useDrawer";
import { RegionFilter } from "../shared/RegionFilter";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { t, dt } from "../../i18n";
import { date } from "../../lib/date";
import { money } from "../../lib/money";
import {
  PageHeader,
  Button,
  Panel,
  Modal,
  Field,
  DataTable,
  KeyValues,
  Loading,
  ErrorState,
  Empty,
  Progress,
} from "../../components/ui";

type VolumeRow = StorageVolume & {
  resourceName: string;
  resourceKind: Kind | null;
};
export default function VolumePage() {
  const kind = useLocation().pathname.endsWith("/file") ? "file" : "block";
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const activeProject = useAuth((s) => s.project);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(activeProject);
  const [tier, setTier] = useState("");
  const [sizeGb, setSizeGb] = useState(100);
  const { id, setId } = useDrawer();
  const list = useData<VolumeRow[]>(
    ["storage-volumes", region],
    EP.storageVolumes + query({ region }),
  );
  const detail = useData<VolumeRow>(
    ["storage-volume", id],
    `${EP.storageVolumes}/${id}`,
    { enabled: !!id },
  );
  const products = useData<StorageProduct[]>(
    ["storage-products"],
    EP.storageProducts,
  );
  const projects = useData<Project[]>(["projects"], EP.projects);
  const quotas = useData<Quota[]>(
    ["storage-quotas", region],
    EP.quotas + query({ region }),
  );
  const { run, busy } = useAction();
  const plans = (products.data || []).filter(
    (product) => product.kind === kind,
  );
  const selectedPlan =
    plans.find((product) => product.tier === tier) || plans[0];
  const capacity = quotas.data
    ?.find((quota) => quota.metric === "storage")
    ?.storageBreakdown?.find((item) => item.kind === kind);
  const rows = (list.data || []).filter(
    (volume) =>
      volume.kind === kind &&
      `${volume.name} ${volume.resourceName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const v = detail.data;
  const projectName = (value: string) =>
    dt(projects.data?.find((project) => project.id === value)?.name || value);
  const openCreate = () => {
    setProjectId(activeProject);
    setTier(plans[0]?.tier || "");
    setSizeGb(plans[0]?.minGb || 100);
    setName("");
    setNewOpen(true);
  };
  return (
    <>
      <PageHeader
        title={t(`storage.kind.${kind}`)}
        subtitle={t(
          kind === "block" ? "storage.blockSubtitle" : "storage.fileSubtitle",
        )}
        actions={
          <Button
            variant="primary"
            disabled={!canWrite(role)}
            onClick={openCreate}
          >
            {t("common.create")}
          </Button>
        }
      />
      <div className="grid grid-3">
        <Panel title={t("storage.volumeList")}>
          <strong>{rows.length}</strong>
        </Panel>
        <Panel title={t("storage.allocatedCapacity")}>
          <strong>{capacity?.usedGb.toLocaleString() || "—"} GB</strong>
        </Panel>
        <Panel title={t("storage.availableCapacity")}>
          <strong>
            {capacity
              ? (capacity.limitGb - capacity.usedGb).toLocaleString()
              : "—"}{" "}
            GB
          </strong>
          {capacity && (
            <Progress value={(capacity.usedGb / capacity.limitGb) * 100} />
          )}
        </Panel>
      </div>
      <div className="toolbar">
        <RegionFilter />
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Panel title={t("storage.volumeList")}>
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} />
        ) : rows.length ? (
          <DataTable
            data={rows}
            onRow={(row) => setId(row.id)}
            columns={[
              { accessorKey: "name", header: t("common.name") },
              { accessorKey: "tier", header: t("storage.tier") },
              {
                accessorKey: "sizeGb",
                header: t("storage.sizeGb"),
                cell: ({ row }) => `${row.original.sizeGb.toLocaleString()} GB`,
              },
              {
                accessorKey: "region",
                header: t("common.region"),
                cell: ({ row }) => t(`common.${row.original.region}`),
              },
              {
                accessorKey: "projectId",
                header: t("common.project"),
                cell: ({ row }) => projectName(row.original.projectId),
              },
              {
                accessorKey: "resourceName",
                header: t("storage.attached"),
                cell: ({ row }) =>
                  row.original.resourceName || t("storage.unattached"),
              },
              {
                accessorKey: "createdAt",
                header: t("common.createdAt"),
                cell: ({ row }) => date(row.original.createdAt),
              },
            ]}
          />
        ) : (
          <Empty text={t("storage.noVolumes")} />
        )}
      </Panel>
      <Modal
        drawer
        open={!!id}
        onClose={() => setId("")}
        title={v?.name || t("storage.volumeList")}
      >
        {detail.isPending ? (
          <Loading />
        ) : detail.error ? (
          <ErrorState error={detail.error} />
        ) : v && v.kind === kind ? (
          <div className="stack">
            <Panel title={t("storage.volumeDetails")}>
              <KeyValues
                items={[
                  ["ID", v.id],
                  [t("common.name"), v.name],
                  [t("common.type"), t(`storage.kind.${v.kind}`)],
                  [t("storage.tier"), v.tier],
                  [t("storage.sizeGb"), `${v.sizeGb.toLocaleString()} GB`],
                  [t("common.region"), t(`common.${v.region}`)],
                  [t("common.project"), projectName(v.projectId)],
                  [
                    t("storage.source"),
                    t(
                      v.resourceUuid
                        ? "storage.deploymentSource"
                        : "storage.standaloneSource",
                    ),
                  ],
                  [t("common.createdAt"), date(v.createdAt)],
                ]}
              />
            </Panel>
            <Panel title={t("storage.connection")}>
              <KeyValues
                items={[
                  [
                    t("storage.attached"),
                    v.resourceName || t("storage.unattached"),
                  ],
                  [
                    t("storage.mountPath"),
                    v.mountPath || t("storage.notMounted"),
                  ],
                  [t("storage.role"), t(`storage.role.${v.role}`)],
                ]}
              />
              {v.resourceUuid && v.resourceKind && (
                <Link
                  to={resourceLink({
                    kind: v.resourceKind,
                    resourceUuid: v.resourceUuid,
                    region: v.region,
                  })}
                >
                  {t("storage.viewResource")}
                </Link>
              )}
            </Panel>
            <Panel title={t("storage.lifecycleSummary")}>
              <KeyValues
                items={[
                  [
                    t("common.status"),
                    t(v.resourceUuid ? "storage.inUse" : "storage.available"),
                  ],
                  [
                    t("storage.monthlyEstimate"),
                    money(
                      v.sizeGb *
                        (products.data?.find(
                          (product) =>
                            product.kind === v.kind && product.tier === v.tier,
                        )?.usdGbMonth || 0),
                    ),
                  ],
                  [
                    t("storage.deletePolicy"),
                    t(
                      v.resourceUuid
                        ? "storage.deleteWithResource"
                        : "storage.deleteManually",
                    ),
                  ],
                ]}
              />
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy || !!v.resourceUuid}
                onClick={async () => {
                  if (!(await confirmAction(`${t("common.delete")} ${v.name}`)))
                    return;
                  const ok = await run(async () => {
                    await remove(`${EP.storageVolumes}/${v.id}`);
                    return true;
                  });
                  if (ok) setId("");
                }}
              >
                {t("common.delete")}
              </Button>
            </Panel>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={t(
          kind === "block" ? "storage.createBlock" : "storage.createFile",
        )}
      >
        <div className="stack">
          <Field label={t("common.name")}>
            <input
              className="input"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label={t("common.project")}>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {projects.data
                  ?.filter((project) => !project.deletedAt)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {dt(project.name)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("common.region")}>
              <strong>{t(`common.${region}`)}</strong>
            </Field>
            <Field label={t("storage.tier")}>
              <select
                value={selectedPlan?.tier || ""}
                onChange={(event) => {
                  const plan = plans.find(
                    (item) => item.tier === event.target.value,
                  );
                  setTier(event.target.value);
                  if (plan) setSizeGb(plan.minGb);
                }}
              >
                {plans.map((plan) => (
                  <option key={plan.tier} value={plan.tier}>
                    {plan.tier}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={t("storage.sizeGb")}
              hint={
                selectedPlan
                  ? `${selectedPlan.minGb}–${selectedPlan.maxGb} GB · ${selectedPlan.stepGb} GB`
                  : ""
              }
            >
              <input
                className="input"
                type="number"
                min={selectedPlan?.minGb}
                max={selectedPlan?.maxGb}
                step={selectedPlan?.stepGb}
                value={sizeGb}
                onChange={(event) => setSizeGb(Number(event.target.value))}
              />
            </Field>
          </div>
          <Panel title={t("storage.orderSummary")}>
            <KeyValues
              items={[
                [
                  t("storage.monthlyEstimate"),
                  selectedPlan ? money(sizeGb * selectedPlan.usdGbMonth) : "—",
                ],
                [
                  t("storage.availableCapacity"),
                  capacity
                    ? `${(capacity.limitGb - capacity.usedGb).toLocaleString()} GB`
                    : "—",
                ],
                [t("storage.connection"), t("storage.unattached")],
              ]}
            />
          </Panel>
          <Button
            variant="primary"
            disabled={
              !canWrite(role) ||
              busy ||
              !selectedPlan ||
              !projectId ||
              name.trim().length < 2 ||
              sizeGb < selectedPlan.minGb ||
              sizeGb > selectedPlan.maxGb ||
              sizeGb % selectedPlan.stepGb !== 0 ||
              (!!capacity && sizeGb > capacity.limitGb - capacity.usedGb)
            }
            onClick={async () => {
              const created = await run(
                () =>
                  post<StorageVolume>(EP.storageVolumes, {
                    name: name.trim(),
                    kind,
                    tier: selectedPlan?.tier,
                    sizeGb,
                    projectId,
                    region,
                  }),
                "success.created",
              );
              if (created) {
                setNewOpen(false);
                setId(created.id);
              }
            }}
          >
            {t("common.create")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
