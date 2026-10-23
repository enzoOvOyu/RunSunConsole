import { bucketStoredBytes } from "../../lib/storage";
import type { Bucket, Kind, ResourceUuid } from "../../types/domain";
import type { ClusterView } from "../../types/monitoring";
import type { StorageVolume } from "../../types/storage";
import { formatResourceId } from "../../lib/ids";
import { isRegionalPoolVolume } from "../../lib/storage";

export type VolumeRow = StorageVolume & {
  resourceName: string;
  resourceKind: Kind | null;
  accessClients?: { resourceUuid: ResourceUuid; name: string; displayId: string; kind: Kind; privateIp: string }[];
};

export type VolumeFilters = {
  search: string;
  projectId: string;
  tier: string;
  status: string;
  zone: string;
};

export function selectVolumeRows(
  volumes: VolumeRow[],
  kind: StorageVolume["kind"],
  filters: VolumeFilters,
  projectName: (id: string) => string,
) {
  const all = volumes.filter(
    (volume) =>
      volume.kind === kind && !isRegionalPoolVolume(volume),
  );
  const needle = filters.search.trim().toLowerCase();
  const visible = all.filter((volume) => {
    const searchable = [
      volume.name,
      volume.id,
      formatResourceId(kind === "block" ? "blk" : "fil", volume.id),
      volume.resourceName,
      ...(volume.accessClients || []).flatMap((client) => [client.name, client.displayId, client.privateIp]),
      volume.fileAccess?.vpcId,
      volume.fileAccess?.allowedCidr,
      volume.projectId,
      formatResourceId("prj", volume.projectId),
      projectName(volume.projectId),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!needle || searchable.includes(needle)) &&
      (!filters.projectId || volume.projectId === filters.projectId) &&
      (!filters.tier || volume.tier === filters.tier) &&
      (!filters.status ||
        (filters.status === "attached"
          ? !!volume.resourceUuid
          : !volume.resourceUuid)) &&
      (!filters.zone || (volume.zone || `${volume.region}-a`) === filters.zone)
    );
  });
  return { all, visible };
}

export function selectFileMounts(
  view: ClusterView | undefined,
  volumeId: string | undefined,
) {
  const pv = view?.storage.pvs.find((item) => item.volumeId === volumeId);
  const pvc = pv
    ? view?.storage.pvcs.find((item) => item.pvName === pv.name)
    : undefined;
  const workloads = pvc
    ? view?.workloads.filter(
        (item) => item.namespace === pvc.namespace && item.pvcName === pvc.name,
      ) || []
    : [];
  const pods = workloads
    .flatMap((item) => item.pods)
    .filter((pod) => pod.phase === "Running" && !!pod.nodeUuid);
  const nodes = [
    ...new Set(
      pods
        .map(
          (pod) =>
            view?.nodes.find((node) => node.nodeUuid === pod.nodeUuid)?.name,
        )
        .filter((name): name is string => !!name),
    ),
  ];
  return { pv, pvc, workloads, pods, nodes };
}

export type BucketFilters = {
  search: string;
  projectId: string;
  storageClass: string;
  status: string;
  fileInterface?: string;
};

export function selectBucketRows(
  buckets: Bucket[],
  filters: BucketFilters,
  projectName: (id?: string) => string,
) {
  const needle = filters.search.trim().toLowerCase();
  return buckets.filter((bucket) => {
    const searchable = [
      bucket.name,
      bucket.id,
      formatResourceId("obj", bucket.id),
      bucket.projectId || "",
      formatResourceId("prj", bucket.projectId || ""),
      projectName(bucket.projectId),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!needle || searchable.includes(needle)) &&
      (!filters.projectId || bucket.projectId === filters.projectId) &&
      (!filters.storageClass ||
        (bucket.storageClass || "STANDARD") === filters.storageClass) &&
      (!filters.status || bucket.access === filters.status) &&
      (!filters.fileInterface ||
        (filters.fileInterface === "configured" ? !!bucket.fileInterface : !bucket.fileInterface))
    );
  });
}

export function bucketSummary(buckets: Bucket[]) {
  return buckets.reduce(
    (summary, bucket) => {
      summary.limitGb += bucket.quotaGb;
      summary.objectCount += bucket.objects.length;
      summary.actualBytes += bucketStoredBytes(bucket);
      return summary;
    },
    { limitGb: 0, objectCount: 0, actualBytes: 0 },
  );
}
