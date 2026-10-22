import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StorageProduct, StorageVolume } from "../../types/storage";
import { selectFileMounts, selectVolumeRows, type VolumeRow } from "../shared/storageView";
import { VolumeTable } from "./VolumeTable";
import type { DeploymentOptions, Project, Quota, Resource } from "../../types/domain";
import type { ClusterView } from "../../types/monitoring";
import { EP, post, query, remove } from "../../lib/api-client";
import { formatResourceId, resourceLink } from "../../lib/ids";
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
  KeyValues,
  Loading,
  ErrorState,
  Empty,
  Progress,
  CopyButton,
} from "../../components/ui";

export default function VolumePage() {
  const location = useLocation();
  const kind = location.pathname.endsWith("/file") ? "file" : "block";
  const requestedProjectId = new URLSearchParams(location.search).get("project_id") || "";
  const region = useRegion((s) => s.region);
  const role = useAuth((s) => s.role);
  const activeProject = useAuth((s) => s.project);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [newOpen, setNewOpen] = useState(() => new URLSearchParams(location.search).get("create") === "1");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(requestedProjectId || activeProject);
  const [tier, setTier] = useState("");
  const [sizeGb, setSizeGb] = useState(100);
  const [zone, setZone] = useState(`${region}-a`);
  useEffect(() => setZone(`${region}-a`), [region]);
  const [targetResource, setTargetResource] = useState("");
  const [mountPath, setMountPath] = useState("/mnt/storage");
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
  const resources = useData<{ items: Resource[] }>(
    [
      "storage-attachable-resources",
      region,
      detail.data?.projectId || projectId,
    ],
    EP.resources +
      query({
        region,
        project_id: detail.data?.projectId || projectId,
        size: 1000,
      }),
  );
  const clusterRuntime = useData<ClusterView>(
    ["storage-file-cluster", detail.data?.resourceUuid],
    `${EP.metrics}/vgpu/${detail.data?.resourceUuid}/cluster`,
    { enabled: kind === "file" && !!id && detail.data?.resourceKind === "vgpu" },
  );
  const networkOptions = useData<DeploymentOptions>(
    ["storage-network-options", region, detail.data?.projectId || projectId],
    EP.options + query({ region, project_id: detail.data?.projectId || projectId, kind: "gpu_vm" }),
    { enabled: kind === "block" && !!id },
  );
  const quotas = useData<Quota[]>(
    ["storage-quotas", region],
    EP.quotas + query({ region }),
  );
  const { run, busy } = useAction();
  const queryClient = useQueryClient();
  const plans = (products.data || []).filter(
    (product) => product.kind === kind,
  );
  const selectedPlan =
    plans.find((product) => product.tier === tier) || plans[0];
  const capacity = quotas.data
    ?.find((quota) => quota.metric === "storage")
    ?.storageBreakdown?.find((item) => item.kind === kind);
  const availableProjects = (projects.data || []).filter((project) => !project.deletedAt);
  const selectedProjectId = availableProjects.some((project) => project.id === projectId)
    ? projectId
    : availableProjects.find((project) => project.id === activeProject)?.id ||
      availableProjects.find((project) => project.isDefault)?.id ||
      availableProjects[0]?.id || "";
  const projectName = (value: string) =>
    dt(projects.data?.find((project) => project.id === value)?.name || value);
  const { all: kindRows, visible: rows } = selectVolumeRows(
    list.data || [], kind,
    { search, projectId: projectFilter, tier: tierFilter, status: statusFilter, zone: zoneFilter },
    projectName,
  );
  const filterActive = !!(search || projectFilter || tierFilter || statusFilter || zoneFilter);
  const v = detail.data;
  const targetZone = (resource: Resource) => networkOptions.data?.vpcs
    .flatMap((vpc) => vpc.subnets)
    .find((subnet) => subnet.id === resource.spec.subnet)?.zone;
  const attachable = (resources.data?.items || []).filter(
    (resource) =>
      resource.projectId === v?.projectId &&
      resource.region === v?.region &&
      resource.status === "running" &&
      (kind === "block"
        ? resource.kind === "gpu_vm" && targetZone(resource) === (v?.zone || `${v?.region}-a`)
        : ["gpu_vm", "inference", "vgpu"].includes(resource.kind)),
  );
  const linkedResource = v?.resourceUuid ? resources.data?.items.find((resource) => resource.resourceUuid === v.resourceUuid) : undefined;
  const { pv: linkedPv, pvc: linkedPvc, workloads: linkedWorkloads, pods: linkedPods, nodes: linkedNodeNames } =
    selectFileMounts(clusterRuntime.data, v?.id);
  const targetIsCluster = attachable.some((resource) => resource.resourceUuid === targetResource && resource.kind === "vgpu");
  const openCreate = () => {
    setProjectId(selectedProjectId);
    setTier(plans[0]?.tier || "");
    setSizeGb(plans[0]?.minGb || 100);
    setName("");
    setZone(`${region}-a`);
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
      <div className="grid grid-3 resource-summary-grid">
        <Panel
          title={t(kind === "file" ? "storage.fileSystemCount" : "storage.volumeCount")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">{list.data ? (kind === "file" ? kindRows.length : rows.length) : "—"}</div>
          <small>{t(kind === "file" ? "storage.currentRegionFileSystems" : "storage.filteredResources")}</small>
        </Panel>
        <Panel
          title={t("storage.configuredCapacity")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">
            {(kind === "file" ? kindRows : rows).reduce((sum, volume) => sum + volume.sizeGb, 0).toLocaleString()}
            <span className="resource-unit">GB</span>
          </div>
          <small>{t("storage.configuredCapacity")}</small>
        </Panel>
        <Panel
          title={t(kind === "file" ? "storage.linkedFileSystems" : "storage.availableCapacity")}
          className="resource-summary-card"
        >
          <div className="resource-summary-value">
            {kind === "file"
              ? (list.data ? kindRows.filter((volume) => !!volume.resourceUuid).length : "—")
              : (capacity ? Math.max(0, capacity.limitGb - capacity.usedGb).toLocaleString() : "—")}
            {kind === "block" && <span className="resource-unit">GB</span>}
          </div>
          {kind === "file" ? <small>{t("storage.linkedFileSystemsHint")}</small> : capacity && (
            <div className="resource-summary-progress">
              <Progress value={(capacity.usedGb / capacity.limitGb) * 100} />
              <small>{t("storage.regionUsage", { used: capacity.usedGb.toLocaleString(), limit: capacity.limitGb.toLocaleString() })} GB</small>
            </div>
          )}
        </Panel>
      </div>
      <div className="toolbar storage-volume-filters">
        <RegionFilter />
        <input className="input search" aria-label={t("common.search")}
          placeholder={t("storage.searchVolumes")} value={search}
          onChange={(event) => setSearch(event.target.value)} />
        <select aria-label={t("common.project")} value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="">{t("common.allProjects")}</option>
          {availableProjects.map((project) => <option key={project.id} value={project.id}>{dt(project.name)} · {formatResourceId("prj", project.id)}</option>)}
        </select>
        <select aria-label={t("storage.tier")} value={tierFilter}
          onChange={(event) => setTierFilter(event.target.value)}>
          <option value="">{t("storage.allTiers")}</option>
          {plans.map((plan) => <option key={plan.tier} value={plan.tier}>{plan.tier}</option>)}
        </select>
        <select aria-label={t("common.status")} value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">{t("storage.allStatuses")}</option>
          <option value="free">{t("storage.available")}</option>
          <option value="attached">{t("storage.inUse")}</option>
        </select>
        {kind === "block" && <select aria-label={t("eks.availableZones")} value={zoneFilter}
          onChange={(event) => setZoneFilter(event.target.value)}>
          <option value="">{t("storage.allZones")}</option>
          {["a", "b"].map((suffix) => <option key={suffix} value={`${region}-${suffix}`}>{region.toUpperCase()}-{suffix.toUpperCase()}</option>)}
        </select>}
        {filterActive && <Button onClick={() => { setSearch(""); setProjectFilter(""); setTierFilter(""); setStatusFilter(""); setZoneFilter(""); }}>{t("common.reset")}</Button>}
      </div>
      {kind === "file" && <div className="storage-file-intro">
        <div><strong>{t("storage.fileSharingTitle")}</strong><p>{t("storage.fileSharingIntro")}</p></div>
        <div className="storage-file-flow" aria-label={t("storage.fileSharingFlow")}>
          <span>{t("storage.fileSystem")}</span><span aria-hidden="true">→</span><span>{t("storage.pvAndPvc")}</span><span aria-hidden="true">→</span><span>{t("storage.computeConsumers")}</span>
        </div>
      </div>}
      <Panel title={t(kind === "file" ? "storage.fileSystemList" : "storage.volumeList")}>
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <ErrorState error={list.error} />
        ) : rows.length ? (
          <VolumeTable rows={rows} kind={kind} projectName={projectName} onDetails={setId} />
        ) : (
          <Empty text={t(filterActive ? "common.noResults" : "storage.noVolumes")} />
        )}
      </Panel>
      <Modal
        drawer
        open={!!id}
        onClose={() => setId("")}
        title={v?.name || t(kind === "file" ? "storage.fileSystemList" : "storage.volumeList")}
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
                  [
                    "ID",
                    formatResourceId(v.kind === "block" ? "blk" : "fil", v.id),
                  ],
                  [t("common.name"), v.name],
                  [t("common.type"), t(`storage.kind.${v.kind}`)],
                  [t("storage.tier"), v.tier],
                  ...(kind === "block" ? [[t("eks.availableZones"), v.zone || `${v.region}-a`] as [string, string]] : []),
                  [t("storage.sizeGb"), `${v.sizeGb.toLocaleString()} GB`],
                  [t("common.region"), t(`common.${v.region}`)],
                  [t("common.project"), `${projectName(v.projectId)} · ${formatResourceId("prj", v.projectId)}`],
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
            {kind === "block" && <Panel title={t("storage.connection")}>
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
                  ...(kind === "block" ? [[t("eks.availableZones"), v.zone || `${v.region}-a`] as [string, string]] : []),
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
            </Panel>}
            {kind === "file" && <Panel title={t("storage.fileMountRelations")} className="storage-file-relations">
              <p className="storage-file-relation-note">{t(v.resourceUuid ? "storage.fileLinkedHint" : "storage.fileUnlinkedHint")}</p>
              <KeyValues items={[
                [t("storage.fileSystem"), formatResourceId("fil", v.id)],
                [t("storage.linkedCompute"), linkedResource ? `${dt(linkedResource.name)} · ${linkedResource.displayId}` : t("storage.unattached")],
                ...(linkedResource?.kind === "vgpu" ? [
                  [t("storage.nodePoolReach"), `${linkedResource.spec.nodePools.length} ${t("storage.nodePools")}`],
                  [t("storage.pv"), linkedPv?.name || "—"],
                  [t("storage.pvc"), linkedPvc ? `${linkedPvc.namespace}/${linkedPvc.name} · ${linkedPvc.status}` : "—"],
                  [t("storage.workload"), linkedWorkloads.length ? linkedWorkloads.map((workload) => `${workload.deployment} (${workload.namespace})`).join(", ") : t("storage.noWorkloadConsumer")],
                  [t("storage.runningPodMounts"), linkedPods.length],
                  [t("storage.consumerNodes"), linkedNodeNames.length ? linkedNodeNames.join(", ") : "—"],
                ] as [string, string | number][] : [
                  [t("storage.accessPath"), v.mountPath || "—"],
                ] as [string, string][]),
              ]} />
              {v.mountPath && linkedResource?.kind !== "vgpu" && <div className="row"><code>{v.mountPath}</code><CopyButton value={v.mountPath} /></div>}
              {linkedResource?.kind === "vgpu" && <small>{t("storage.fileNodePoolHint")}</small>}
              {v.resourceUuid && v.resourceKind && <Link to={resourceLink({ kind: v.resourceKind, resourceUuid: v.resourceUuid, region: v.region })}>{t("storage.viewResource")}</Link>}
            </Panel>}
            {v.role === "custom" && !v.resourceUuid && (
              <Panel title={t("storage.useVolume")}>
                <div className="stack">
                  <Field label={t("nav.resources")}>
                    <select
                      value={targetResource}
                      onChange={(event) =>
                        setTargetResource(event.target.value)
                      }
                    >
                      <option value="">{t("storage.selectTarget")}</option>
                      {!attachable.length && <option value="" disabled>{t(kind === "block" ? "storage.noCompatibleVmZone" : "storage.noAttachableResource")}</option>}
                      {attachable.map((resource) => (
                        <option
                          key={resource.resourceUuid}
                          value={resource.resourceUuid}
                        >
                          {dt(resource.name)} · {resource.displayId}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {targetIsCluster && <small>{t("storage.clusterFileBindingHint")}</small>}
                  {!targetIsCluster && <Field
                    label={t("storage.mountPath")}
                    hint={t("storage.mountPathHint")}
                  >
                    <input
                      className="input"
                      value={mountPath}
                      aria-invalid={
                        !/^\/[A-Za-z0-9/._-]+$/.test(mountPath.trim())
                      }
                      onChange={(event) => setMountPath(event.target.value)}
                    />
                    {!/^\/[A-Za-z0-9/._-]+$/.test(mountPath.trim()) && (
                      <small className="field-error">
                        {t("storage.mountPathInvalid")}
                      </small>
                    )}
                  </Field>}
                  <Button
                    variant="primary"
                    disabled={
                      !canWrite(role) ||
                      busy ||
                      !targetResource ||
                      (!targetIsCluster && !/^\/[A-Za-z0-9/._-]+$/.test(mountPath.trim()))
                    }
                    onClick={async () => {
                      const result = await run(() =>
                        post(`${EP.storageVolumes}/${v.id}/attach`, {
                          resourceUuid: targetResource,
                          mountPath: targetIsCluster ? "/pvc/default/data" : mountPath.trim(),
                        }),
                      );
                      if (result) setTargetResource("");
                    }}
                  >
                    {t("storage.attach")}
                  </Button>
                </div>
              </Panel>
            )}
            {v.resourceUuid && (v.role === "custom" || (v.kind === "file" && v.role === "pvc" && v.resourceKind === "vgpu")) && (
              <Button
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  const result = await run(() =>
                    post(`${EP.storageVolumes}/${v.id}/detach`, {}),
                  );
                  if (result) setTargetResource("");
                }}
              >
                {t("storage.detach")}
              </Button>
            )}
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
              maxLength={63}
              aria-invalid={name.trim().length < 3 || name.trim().length > 63}
              onChange={(event) => setName(event.target.value)}
            />
            {(name.trim().length < 3 || name.trim().length > 63) && (
              <small className="field-error">{t("storage.nameInvalid")}</small>
            )}
          </Field>
          <div className="form-grid">
            <Field label={t("common.project")}>
              <select
                value={selectedProjectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {dt(project.name)} · {formatResourceId("prj", project.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("common.region")}>
              <strong>{t(`common.${region}`)}</strong>
            </Field>
            {kind === "block" && <Field label={t("eks.availableZones")}>
              <select value={zone} onChange={(event) => setZone(event.target.value)}>
                {["a", "b"].map((suffix) => <option key={suffix} value={`${region}-${suffix}`}>{region.toUpperCase()}-{suffix.toUpperCase()}</option>)}
              </select>
            </Field>}
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
              !selectedProjectId ||
              name.trim().length < 3 ||
              name.trim().length > 63 ||
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
                    projectId: selectedProjectId,
                    region,
                    zone: kind === "block" ? zone : undefined,
                  }),
                "success.created",
              );
              if (created) {
                const row: VolumeRow = { ...created, resourceName: "", resourceKind: null };
                queryClient.setQueryData(["storage-volume", created.id], row);
                queryClient.setQueryData<VolumeRow[]>(["storage-volumes", region], (current) =>
                  current ? [row, ...current.filter((item) => item.id !== row.id)] : [row]);
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
