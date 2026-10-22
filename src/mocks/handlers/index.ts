import type { ElasticIp, SecurityRule, IpsecTunnel } from "../../types/network";
import {
  NetworkFailure,
  ensureScope,
  networkAudit,
  availableIps,
  subnetUsed,
  checkResourceNetwork,
  syncResourceNetwork,
  releaseResourceNetwork,
  allocateEip,
  nextPrivateIp,
  validVpcCidr,
  verifySubnet,
} from "../lib/network";
import {
  cidrRange,
  cidrContains,
  cidrOverlaps,
  isPublicIpv4,
  vpcNetworkType,
} from "../../lib/network";
import type {
  InferenceGovernance,
  InferenceGovernanceSettings,
} from "../../types/inference";
import {
  hardwareSnapshot,
  clusterView,
  replicaView,
  baremetalMachines,
} from "../lib/runtime";
import { seedResources } from "../fixtures/resources";
import { http, HttpResponse, delay } from "msw";
import {
  KINDS,
  QUOTA_METRICS,
  REGIONS,
  ROLES,
  type Region,
  type Resource,
  type ResourceUuid,
  type Role,
  type Quota,
  type Usage,
  type Invoice,
  type ScalingPolicy,
  type StorageObject,
  type Pipeline,
  type Dataset,
  type Project,
  type Ticket,
  type TicketAttachment,
  type TicketCategory,
} from "../../types/domain";
import { db, persist, addEvent } from "../lib/database";
import { consolePasswordFingerprint } from "../lib/console-auth";
import { RATES } from "../fixtures/pricing";
import { IMAGES, PIPELINES } from "../fixtures/content";
import { poolsFor, GPU_SPECS } from "../fixtures/gpu-specs";
import {
  provisioningSeconds,
  meteringLines,
  estimate,
  quotaUse,
  costPerHour,
  modelMemory,
} from "../lib/derive";
import {
  orderSchema,
  scalingSchema,
  isCidr,
  inferenceGovernanceSchema,
} from "../../lib/schema";
import { canWrite, canManageOrg } from "../../lib/rbac";
import { displayId, formatResourceId, resourceLink } from "../../lib/ids";
import { round } from "../../lib/money";
import { invoicePeriodForSelection } from "../../lib/billing-period";
import { compatiblePrecisions } from "../../lib/inference-precision";
import { STORAGE_PRODUCTS } from "../../lib/storage";
import { volumesForResource } from "../fixtures/storage";
import { metricsFor } from "../metrics";
import { z } from "zod";
import { putObject, getObject, deleteObject } from "../lib/object-store";
import { faultFor } from "../lib/fault-injector";
import { normalizeSpec } from "../../lib/config";
class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
function fail(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): never {
  throw new Failure(status, code, details);
}
const resource = (id: string) =>
  db.resources.find((r) => r.resourceUuid === id) || fail(404, "NOT_FOUND");
const live = () => db.resources.filter((r) => !r.deletedAt);
const limits: Record<Region, Record<Quota["metric"], number>> = {
  jp: { gpu: 528, vcpu: 8448, memory: 135168, storage: 1_000_000, ip: 24 },
  sg: { gpu: 320, vcpu: 5120, memory: 90112, storage: 500_000, ip: 12 },
  us: { gpu: 768, vcpu: 12288, memory: 196608, storage: 1_000_000, ip: 32 },
};
const storageLimits: Record<
  Region,
  Record<"block" | "file" | "object", number>
> = {
  jp: { block: 450_000, file: 350_000, object: 200_000 },
  sg: { block: 225_000, file: 175_000, object: 100_000 },
  us: { block: 450_000, file: 325_000, object: 225_000 },
};
const initialAllocations = seedResources();
function storageQuotaBreakdown(region: Region, exclude?: string) {
  return (["block", "file", "object"] as const).map((kind) => ({
    kind,
    limitGb: storageLimits[region][kind],
    usedGb:
      kind === "object"
        ? db.buckets
            .filter(
              (bucket) =>
                bucket.region === region &&
                (!exclude || bucket.attachedResourceUuid !== exclude),
            )
            .reduce((total, bucket) => total + bucket.quotaGb, 0)
        : db.volumes
            .filter(
              (volume) =>
                volume.region === region &&
                volume.kind === kind &&
                volume.resourceUuid !== exclude &&
                !volume.deletedAt,
            )
            .reduce((total, volume) => total + volume.sizeGb, 0),
  }));
}
const used = (region: Region, metric: Quota["metric"], exclude?: string) =>
  metric === "ip"
    ? db.network.eips.filter((e) => e.region === region && !e.releasedAt).length
    : metric === "storage"
      ? storageQuotaBreakdown(region, exclude).reduce(
          (total, allocation) => total + allocation.usedGb,
          0,
        )
      : live()
          .filter((r) => r.region === region && r.resourceUuid !== exclude)
          .reduce((total, r) => total + quotaUse(r, metric), 0);
const networkLimits = {
  jp: { vpc: 30, subnet: 150, security_group: 150, tunnel: 30 },
  sg: { vpc: 20, subnet: 100, security_group: 100, tunnel: 20 },
  us: { vpc: 30, subnet: 150, security_group: 150, tunnel: 30 },
};
type NetworkMetric = keyof typeof networkLimits.jp;
function networkUsed(region: Region, metric: NetworkMetric) {
  const list =
    metric === "vpc"
      ? db.network.vpcs
      : metric === "subnet"
        ? db.network.subnets
        : metric === "security_group"
          ? db.network.groups
          : db.network.tunnels;
  return list.filter((x) => x.region === region && !x.deletedAt).length;
}
function checkNetworkQuota(
  region: Region,
  metric: NetworkMetric,
  requested = 1,
) {
  const usedValue = networkUsed(region, metric);
  const limit = networkLimits[region][metric];
  if (usedValue + requested > limit)
    fail(409, "QUOTA_EXCEEDED", { metric, limit, used: usedValue, requested });
}
export const quotas = (): Quota[] =>
  REGIONS.flatMap((region) =>
    QUOTA_METRICS.map((metric) => ({
      region,
      metric,
      limitValue:
        metric === "storage"
          ? Object.values(storageLimits[region]).reduce(
              (total, limit) => total + limit,
              0,
            )
          : limits[region][metric],
      usedValue: used(region, metric),
      ...(metric === "storage"
        ? { storageBreakdown: storageQuotaBreakdown(region) }
        : {}),
    })),
  );
const period = (u: Usage, p: string) => u.usageHour.startsWith(p);
function voucherUsedInPeriod(billingPeriod: string) {
  return round(
    db.vouchers
      .flatMap((voucher) => voucher.redemptions)
      .filter((redemption) => redemption.at.startsWith(billingPeriod))
      .reduce((sum, redemption) => sum + redemption.amount, 0),
  );
}
function invoicesForSelection(selectedPeriod: string): Invoice[] {
  const billingPeriod = invoicePeriodForSelection(selectedPeriod);
  if (!billingPeriod) return [];
  const existing = db.invoices.find(
    (invoice) => invoice.period === billingPeriod,
  );
  if (existing) return [existing];
  const rows = db.usage.filter((usage) => period(usage, billingPeriod));
  if (!rows.length) return [];
  const grossAmount = round(rows.reduce((sum, usage) => sum + usage.amount, 0));
  const voucherUsed = voucherUsedInPeriod(billingPeriod);
  const invoice: Invoice = {
    id: `invoice-${billingPeriod}`,
    period: billingPeriod,
    issuedAt: new Date().toISOString(),
    status: "paid",
    grossAmount,
    voucherUsed,
    amount: Math.max(0, round(grossAmount - voucherUsed)),
  };
  db.invoices.push(invoice);
  persist();
  return [invoice];
}
function assigned(r: Resource, pool: string) {
  if (r.deletedAt || !["running", "provisioning"].includes(r.status)) return 0;
  return r.kind === "vgpu"
    ? r.spec.nodePools
        .filter((p) => p.poolCode === pool)
        .reduce((n, p) => n + p.nodeCount * p.gpuPerNode, 0)
    : r.nodePool === pool
      ? r.spec.gpuCount
      : 0;
}
function catalogFor(region: Region, exclude?: string) {
  return poolsFor(region).map((pool) => {
    const baseline = initialAllocations
      .filter((r) => r.region === region)
      .reduce((n, r) => n + assigned(r, pool.code), 0);
    const allocated = live()
      .filter((r) => r.region === region && r.resourceUuid !== exclude)
      .reduce((n, r) => n + assigned(r, pool.code), 0);
    const available = Math.max(0, pool.availableGpu + baseline - allocated);
    return {
      ...pool,
      availableGpu: available,
      licenseAvailable: available * 7,
    };
  });
}
function precheck(r: Resource, exclude?: string) {
  const spec = r.spec;
  const scaling = spec.scaling;
  let multiplier = 1;
  if (scaling) {
    const actual =
      r.kind === "gpu_vm"
        ? r.spec.quantity
        : r.kind === "gpu_baremetal"
          ? r.spec.machineCount
          : r.kind === "vgpu"
            ? r.spec.nodePools.reduce((n, p) => n + p.nodeCount, 0)
            : r.spec.replicas;
    if (scaling.max_size < actual || scaling.min_size > actual)
      fail(422, "VALIDATION_ERROR");
    multiplier = scaling.max_size / actual;
    if (
      scaling.strategy_model !==
      (r.kind === "inference" ? "replica" : "node_pool")
    )
      fail(422, "VALIDATION_ERROR");
    if (r.kind !== "inference" && scaling.min_size < 1)
      fail(422, "VALIDATION_ERROR");
    if (
      (r.kind === "inference" || r.kind === "gpu_baremetal") &&
      scaling.max_size > 32
    )
      fail(422, "VALIDATION_ERROR");
    if (
      r.kind === "gpu_baremetal" &&
      (scaling.cooldown_s < 600 || scaling.cooldown_s > 1800)
    )
      fail(422, "VALIDATION_ERROR");
  }
  const pool = catalogFor(r.region, exclude).find((p) => p.code === r.nodePool);
  if (!pool?.available) fail(409, "INSUFFICIENT_CAPACITY");
  if (r.kind === "gpu_vm" && r.spec.gpuPerInstance > pool.gpusPerNode)
    fail(422, "VALIDATION_ERROR");
  const selected =
    r.kind === "vgpu"
      ? r.spec.nodePools.map((p) => ({
          code: p.poolCode,
          count: p.nodeCount * p.gpuPerNode,
          slicing: p.slicingPolicy,
        }))
      : [{ code: r.nodePool, count: spec.gpuCount, slicing: "none" }];
  const poolTotals = new Map<string, number>();
  for (const p of selected)
    poolTotals.set(p.code, (poolTotals.get(p.code) || 0) + p.count);
  for (const p of selected) {
    const catalog = catalogFor(r.region, exclude).find(
      (c) => c.code === p.code,
    );
    if (
      !catalog?.available ||
      (poolTotals.get(p.code) || 0) * multiplier > catalog.availableGpu
    )
      fail(409, "INSUFFICIENT_CAPACITY");
    if (
      p.slicing !== "none" &&
      p.count * multiplier * 7 > catalog.licenseAvailable
    )
      fail(409, "LICENSE_EXCEEDED");
  }
  checkResourceNetwork(db.network, r, multiplier);
  if (r.kind === "gpu_vm" && r.spec.publicIp && !r.spec.eipId) {
    const existing = db.network.interfaces.filter(
      (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
    ).length;
    const requested = Math.max(
      0,
      Math.ceil(r.spec.quantity * multiplier) - existing,
    );
    if (used(r.region, "ip") + requested > limits[r.region].ip)
      fail(409, "QUOTA_EXCEEDED", { metric: "ip" });
    if (db.network.ipSerial + requested > 500) fail(409, "EIP_POOL_EXHAUSTED");
  }
  for (const metric of QUOTA_METRICS) {
    if (metric === "ip") continue;
    const amount =
      quotaUse({ ...r, status: "running" } as Resource, metric) *
      (["gpu", "vcpu", "memory"].includes(metric) ? multiplier : 1);
    if (used(r.region, metric, exclude) + amount > limits[r.region][metric])
      fail(409, "QUOTA_EXCEEDED", {
        metric,
        limit: limits[r.region][metric],
        used: used(r.region, metric, exclude),
        requested: amount,
      });
  }
  const resourceVolumes = volumesForResource(r);
  const requestedStorage = {
    block: resourceVolumes
      .filter((volume) => volume.kind === "block")
      .reduce(
        (total, volume) =>
          total +
          volume.sizeGb *
            (r.kind === "gpu_vm" && ["system", "data"].includes(volume.role)
              ? multiplier
              : 1),
        0,
      ),
    file: resourceVolumes
      .filter((volume) => volume.kind === "file")
      .reduce((total, volume) => total + volume.sizeGb, 0),
    object: (r.spec.storageSelections || [])
      .filter((row) => row.kind === "object")
      .reduce((total, row) => total + row.sizeGb * row.count, 0),
  };
  for (const allocation of storageQuotaBreakdown(r.region, exclude)) {
    const requested = requestedStorage[allocation.kind];
    if (allocation.usedGb + requested > allocation.limitGb)
      fail(409, "QUOTA_EXCEEDED", {
        metric: "storage",
        kind: allocation.kind,
        limit: allocation.limitGb,
        used: allocation.usedGb,
        requested,
      });
  }
  if (r.kind === "inference") {
    const model =
      db.models.find((m) => m.id === r.spec.modelRef) ||
      fail(422, "VALIDATION_ERROR");
    if (model.modality !== "text") fail(422, "MODEL_MODALITY_UNSUPPORTED");
    if (r.spec.maxModelLen > model.context) fail(422, "VALIDATION_ERROR");
    if (
      !compatiblePrecisions(model, r.nodePool, r.spec.engine).includes(
        r.spec.quantization,
      )
    )
      fail(422, "UNSUPPORTED_PRECISION");
    if (
      modelMemory(model, r.spec.quantization, r.spec.maxModelLen).requiredGb >
      pool.memoryGb * r.spec.gpuPerReplica
    )
      fail(422, "MODEL_MEMORY_EXCEEDED");
  }
  if (r.kind === "gpu_vm" || r.kind === "gpu_baremetal") {
    const image = IMAGES.find((i) => i.id === r.spec.imageRef);
    const runtimeImage =
      r.kind === "gpu_vm" && r.spec.runtimeImageRef
        ? IMAGES.find((i) => i.id === r.spec.runtimeImageRef)
        : undefined;
    const poolSpec = GPU_SPECS[r.nodePool];
    if (
      !image ||
      image.type !== "os" ||
      !image.supportedGpuModels.includes(r.nodePool) ||
      !image.architectures.includes(poolSpec.cpuArchitecture) ||
      (r.kind === "gpu_baremetal" && image.sizeGb > r.spec.storageGb) ||
      (r.kind === "gpu_vm" &&
        (image.sizeGb + (runtimeImage?.sizeGb || 0) > r.spec.systemDiskGb ||
          (r.spec.runtimeImageRef &&
            (!runtimeImage ||
              runtimeImage.type !== "container" ||
              !runtimeImage.supportedGpuModels.includes(r.nodePool) ||
              !runtimeImage.architectures.includes(poolSpec.cpuArchitecture) ||
              !runtimeImage.compatibleOsFamilies.includes(image.osFamily)))))
    )
      fail(422, "VALIDATION_ERROR");
  }
  if (
    r.kind === "vgpu" &&
    r.spec.apiServerPublic &&
    !isCidr(r.spec.authorizedCidr)
  )
    fail(422, "VALIDATION_ERROR");
}
let indexedUsage: Usage[] | null = null;
const usageIndex = new Map<string, Usage>();
function usageKey(resourceUuid: string, hour: string, unit: string) {
  return `${resourceUuid}:${hour}:${unit}`;
}
function findUsage(resourceUuid: string, hour: string, unit: string) {
  if (indexedUsage !== db.usage) {
    usageIndex.clear();
    for (const u of db.usage)
      usageIndex.set(usageKey(u.resourceUuid, u.usageHour, u.unit), u);
    indexedUsage = db.usage;
  }
  return usageIndex.get(usageKey(resourceUuid, hour, unit));
}
function settle(r: Resource) {
  const deadline = db.account.depletedAt
    ? new Date(db.account.depletedAt).getTime() +
      (r.status === "running" ? 24 : 192) * 3600000
    : Infinity;
  const now = Math.min(Date.now(), deadline);
  const initial = Math.max(
    new Date(r.createdAt).getTime(),
    Math.floor(now / 3600000) * 3600000,
  );
  let cursor = db.billingCursors[r.resourceUuid] ?? initial;
  if (cursor >= now) return;
  db.billingCursors[r.resourceUuid] = now;
  if (r.deletedAt || r.status === "provisioning" || r.status === "terminating")
    return;
  const e = estimate(r, RATES);
  let delta = 0;
  while (cursor < now) {
    const hour = Math.floor(cursor / 3600000) * 3600000;
    const end = Math.min(now, hour + 3600000);
    const hours = (end - cursor) / 3600000;
    for (const line of meteringLines(e).filter((l) => l.key !== "ip")) {
      const quantity =
        line.quantity *
        hours *
        (r.status === "running" || line.key === "storage" ? 1 : 0);
      const id = `${r.resourceUuid}-${hour}-${line.unit}`;
      let u = findUsage(
        r.resourceUuid,
        new Date(hour).toISOString(),
        line.unit,
      );
      if (!u) {
        u = {
          id,
          resourceUuid: r.resourceUuid,
          displayId: r.displayId,
          projectId: r.projectId,
          region: r.region,
          kind: r.kind,
          usageHour: new Date(hour).toISOString(),
          unit: line.unit,
          quantity: 0,
          unitPrice: line.unitPrice,
          amount: 0,
          status: r.status,
        };
        db.usage.push(u);
        usageIndex.set(usageKey(u.resourceUuid, u.usageHour, u.unit), u);
      }
      const old = u.amount;
      const meter = db.usageMeters[u.id] ?? {
        quantity: u.quantity,
        amount: u.quantity * u.unitPrice,
      };
      meter.quantity += quantity;
      meter.amount += quantity * line.unitPrice;
      db.usageMeters[u.id] = meter;
      u.quantity = round(meter.quantity, 4);
      u.unitPrice = meter.quantity
        ? meter.amount / meter.quantity
        : line.unitPrice;
      u.amount = round(u.quantity * u.unitPrice, 4);
      delta += u.amount - old;
    }
    cursor = end;
  }
  if (delta > 0) {
    const eligible = db.vouchers
      .filter(
        (v) =>
          v.remaining > 0 &&
          new Date(v.expiresAt).getTime() > now &&
          v.kinds.includes(r.kind) &&
          v.regions.includes(r.region),
      )
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    db.voucherPending[r.resourceUuid] = eligible.length
      ? (db.voucherPending[r.resourceUuid] || 0) + delta
      : 0;
    let eligibleCredit =
      Math.floor((db.voucherPending[r.resourceUuid] + Number.EPSILON) * 100) /
      100;
    for (const voucher of eligible) {
      const credit = round(Math.min(eligibleCredit, voucher.remaining));
      if (credit <= 0) continue;
      voucher.remaining = round(voucher.remaining - credit);
      voucher.redemptions.push({
        at: new Date(now).toISOString(),
        amount: credit,
        referenceId: `invoice-${new Date(now).toISOString().slice(0, 7)}`,
      });
      db.voucherPending[r.resourceUuid] = Math.max(
        0,
        db.voucherPending[r.resourceUuid] - credit,
      );
      eligibleCredit = round(eligibleCredit - credit);
      db.account.creditBalance = round(db.account.creditBalance + credit, 4);
      db.transactions.push({
        id: `voucher-${voucher.id}-${crypto.randomUUID()}`,
        resourceUuid: r.resourceUuid,
        at: new Date(now).toISOString(),
        type: "voucher",
        amount: credit,
        balanceAfter: db.account.creditBalance,
        referenceId: `invoice-${new Date(now).toISOString().slice(0, 7)}`,
      });
    }
    db.account.creditBalance = round(db.account.creditBalance - delta, 4);
    db.transactions.push({
      id: crypto.randomUUID(),
      resourceUuid: r.resourceUuid,
      at: new Date(now).toISOString(),
      type: "charge",
      amount: -round(delta, 4),
      balanceAfter: db.account.creditBalance,
      referenceId: `usage-${r.resourceUuid}-${Math.floor(now / 3600000)}`,
    });
    if (db.transactions.length > 5000)
      db.transactions.splice(0, db.transactions.length - 5000);
    if (db.account.creditBalance < 0 && !db.account.depletedAt)
      db.account.depletedAt = new Date(now).toISOString();
  }
}
function ipHourly(region: Region) {
  return RATES.find((r) => r.region === region && r.unit === "per_ip_hour")!
    .unitPrice;
}
function settleEips() {
  for (const e of db.network.eips) {
    const deadline = db.account.depletedAt
      ? new Date(db.account.depletedAt).getTime() + 8 * 86400000
      : Infinity;
    if (!e.releasedAt && Date.now() >= deadline) {
      const tunnel = db.network.tunnels.find((t) => t.id === e.tunnelId);
      if (tunnel) {
        tunnel.enabled = false;
        tunnel.deletedAt = new Date(deadline).toISOString();
      }
      e.interfaceId = null;
      e.tunnelId = null;
      e.releasedAt = new Date(deadline).toISOString();
      networkAudit(db.network, e, e.id, "eipRelease");
    }
    const now = Math.min(
      Date.now(),
      e.releasedAt ? new Date(e.releasedAt).getTime() : Infinity,
    );
    let cursor = db.billingCursors[e.id] ?? new Date(e.createdAt).getTime();
    if (cursor >= now) continue;
    let delta = 0;
    const rate = ipHourly(e.region);
    while (cursor < now) {
      const hour = Math.floor(cursor / 3600000) * 3600000;
      const end = Math.min(now, hour + 3600000);
      const hours = (end - cursor) / 3600000;
      const at = new Date(hour).toISOString();
      let u = findUsage(e.id, at, "per_ip_hour");
      if (!u) {
        u = {
          id: `${e.id}-${hour}-per_ip_hour`,
          resourceUuid: e.id,
          displayId: e.displayId,
          projectId: e.projectId,
          region: e.region,
          kind: "eip",
          usageHour: at,
          unit: "per_ip_hour",
          quantity: 0,
          unitPrice: rate,
          amount: 0,
          status: "running",
        };
        db.usage.push(u);
        usageIndex.set(usageKey(e.id, at, "per_ip_hour"), u);
      }
      const old = u.amount;
      const meter = db.usageMeters[u.id] ?? {
        quantity: u.quantity,
        amount: u.quantity * u.unitPrice,
      };
      meter.quantity += hours;
      meter.amount += hours * rate;
      db.usageMeters[u.id] = meter;
      u.quantity = round(meter.quantity, 4);
      u.unitPrice = meter.quantity ? meter.amount / meter.quantity : rate;
      u.amount = round(u.quantity * u.unitPrice, 4);
      delta += u.amount - old;
      cursor = end;
    }
    db.billingCursors[e.id] = now;
    if (delta > 0) {
      db.account.creditBalance = round(db.account.creditBalance - delta, 4);
      db.transactions.push({
        id: crypto.randomUUID(),
        resourceUuid: e.id,
        at: new Date(now).toISOString(),
        type: "charge",
        amount: -round(delta, 4),
        balanceAfter: db.account.creditBalance,
        referenceId: `eip-${e.id}-${Math.floor(now / 3600000)}`,
      });
      if (db.account.creditBalance < 0 && !db.account.depletedAt)
        db.account.depletedAt = new Date(now).toISOString();
    }
  }
}
function tick(settleBilling = true) {
  let lifecycleChanged = false;
  if (db.account.creditBalance >= 0) db.account.depletedAt = null;
  else db.account.depletedAt ??= new Date().toISOString();

  for (const r of live()) {
    if (settleBilling) settle(r);
    if (db.account.depletedAt) {
      const start = new Date(db.account.depletedAt).getTime();
      const age = Date.now() - start;
      if (age >= 86400000 && r.status === "running") {
        if (!settleBilling) settle(r);
        r.status = "stopped";
        r.runningSince = null;
        r.stoppedAt = new Date(start + 86400000).toISOString();
        addEvent(r, "stopped", "running", "stopped");
        settle(r);
        lifecycleChanged = true;
      }
      if (age >= 8 * 86400000) {
        if (!settleBilling) settle(r);
        releaseResourceNetwork(db.network, r.resourceUuid);
        r.deletedAt = new Date(start + 8 * 86400000).toISOString();
        r.status = "terminating";
        r.runningSince = null;
        addEvent(r, "deleted", "stopped", "terminating");
        lifecycleChanged = true;
        continue;
      }
    }
    if (r.status === "provisioning") {
      const age =
        (Date.now() - new Date(r.provisioningSince || r.createdAt).getTime()) /
        1000;
      const duration = provisioningSeconds(r, db.models);
      if (age >= duration) {
        r.status = "running";
        r.runningSince = new Date(
          new Date(r.provisioningSince || r.createdAt).getTime() +
            duration * 1000,
        ).toISOString();
        db.billingCursors[r.resourceUuid] = new Date(r.runningSince).getTime();
        settle(r);
        const order = db.orders.find((o) => o.resourceUuid === r.resourceUuid);
        if (order) order.status = "completed";
        addEvent(r, "ready", "provisioning", "running");
        db.events[0].at = r.runningSince;
        lifecycleChanged = true;
      }
    }
  }
  if (settleBilling) settleEips();
  if (lifecycleChanged) persist();
}
function summary(
  region: string | null,
  billingPeriod: string,
  resourceId: string | null = null,
  projectId: string | null = null,
) {
  const rs = live().filter(
    (r) =>
      (!region || r.region === region) &&
      (!resourceId || r.resourceUuid === resourceId) &&
      (!projectId || r.projectId === projectId),
  );
  const usage = db.usage.filter(
    (u) =>
      period(u, billingPeriod) &&
      (!region || u.region === region) &&
      (!resourceId || u.resourceUuid === resourceId) &&
      (!projectId || u.projectId === projectId),
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const daily = new Map<
    string,
    {
      amount: number;
      kinds: Record<string, number>;
      projects: Record<string, number>;
    }
  >();
  let monthAmount = 0;
  let todayAmount = 0;
  for (const row of usage) {
    monthAmount += row.amount;
    const day = row.usageHour.slice(0, 10);
    if (day === todayKey) todayAmount += row.amount;
    let entry = daily.get(day);
    if (!entry) {
      entry = { amount: 0, kinds: {}, projects: {} };
      daily.set(day, entry);
    }
    entry.amount += row.amount;
    entry.kinds[row.kind] = (entry.kinds[row.kind] || 0) + row.amount;
    entry.projects[row.projectId] =
      (entry.projects[row.projectId] || 0) + row.amount;
  }
  const month = round(monthAmount);
  const today = round(todayAmount);
  const hourly =
    rs.reduce((a, r) => a + costPerHour(r, RATES), 0) +
    db.network.eips
      .filter(
        (e) =>
          !e.releasedAt &&
          (!region || e.region === region) &&
          (!resourceId || e.id === resourceId) &&
          (!projectId || e.projectId === projectId),
      )
      .reduce((n, e) => n + ipHourly(e.region), 0);
  const [year, monthOfPeriod] = billingPeriod.split("-").map(Number);
  const daysInPeriod =
    year && monthOfPeriod >= 1 && monthOfPeriod <= 12
      ? new Date(Date.UTC(year, monthOfPeriod, 0)).getUTCDate()
      : 0;
  const dates = Array.from({ length: daysInPeriod }, (_, i) =>
    new Date(Date.UTC(year, monthOfPeriod - 1, i + 1))
      .toISOString()
      .slice(0, 10),
  );
  const trend = dates.map((day) => {
    const entry = daily.get(day);
    return {
      date: day,
      amount: round(entry?.amount || 0),
      ...Object.fromEntries(
        [...KINDS, "eip"].map((kind) => [kind, round(entry?.kinds[kind] || 0)]),
      ),
      ...Object.fromEntries(
        db.projects.map((project) => [
          project.id,
          round(entry?.projects[project.id] || 0),
        ]),
      ),
    };
  });
  return {
    month,
    payable: Math.max(
      0,
      round(
        month -
          db.vouchers
            .flatMap((v) => v.redemptions)
            .filter((v) => v.at.startsWith(billingPeriod))
            .reduce((n, v) => n + v.amount, 0),
      ),
    ),
    today,
    hourly,
    total: round(
      db.usage
        .filter((u) => !resourceId || u.resourceUuid === resourceId)
        .reduce((a, u) => a + u.amount, 0),
    ),
    estimate: resourceId
      ? db.resources.some((r) => r.resourceUuid === resourceId)
        ? estimate(resource(resourceId), RATES)
        : null
      : null,
    remainingHours: hourly > 0 ? db.account.creditBalance / hourly : null,
    running: rs.filter((r) => r.status === "running").length,
    allocated: rs.reduce((a, r) => a + quotaUse(r, "gpu"), 0),
    balance: db.account.creditBalance,
    budget: db.account.budget,
    voucherUsed: db.vouchers
      .flatMap((v) => v.redemptions)
      .filter((v) => v.at.startsWith(billingPeriod))
      .reduce((a, v) => a + v.amount, 0),
    trend,
  };
}
function governanceSettings(
  r: Extract<Resource, { kind: "inference" }>,
): InferenceGovernanceSettings {
  return {
    canaryPercent: r.spec.canaryPercent,
    qpsLimit: r.spec.gateway?.qpsLimit ?? 100,
    timeoutMs: r.spec.gateway?.timeoutMs ?? 30000,
  };
}
function enrich(r: Resource): Resource {
  const estimatePrice = estimate(r, RATES);
  const nodeCount =
    r.kind === "gpu_baremetal"
      ? r.spec.machineCount
      : r.kind === "vgpu"
        ? r.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0)
        : Math.ceil(r.spec.gpuCount / GPU_SPECS[r.nodePool].gpusPerNode);
  return {
    ...r,
    privateIp:
      db.network.interfaces.find(
        (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
      )?.privateIp || "—",
    placement: {
      rackId: `${r.region.toUpperCase()}-R${(parseInt(r.resourceUuid.slice(-2), 16) % 8) + 1}`,
      switchGroup: `${r.region.toUpperCase()}-IB-A`,
      nodes:
        r.kind === "gpu_baremetal"
          ? baremetalMachines(r).map((m) => ({
              nodeUuid: m.nodeUuid,
              name: m.name,
              state: m.status,
              gpuCount: m.gpuCount,
            }))
          : Array.from({ length: nodeCount }, (_, i) => ({
              nodeUuid: `${r.resourceUuid}-${i}`,
              name: `${r.displayId}-node-${i + 1}`,
              state:
                r.status === "running"
                  ? "ready"
                  : r.status === "error"
                    ? "quarantined"
                    : "initializing",
              gpuCount: GPU_SPECS[r.nodePool].gpusPerNode,
            })),
    },
    cost: {
      perHour: costPerHour(r, RATES),
      unitPrice: estimatePrice.lines[0].unitPrice,
      unit: estimatePrice.lines[0].unit,
      currency: "USD",
    },
  };
}
async function dispatchNetwork(
  path: string,
  method: string,
  qs: URLSearchParams,
  body: Record<string, unknown>,
  role: Role,
) {
  const n = db.network;
  const base = "/api/network/";
  const parts = path.slice(base.length).split("/");
  const [kind, id, action, ruleId] = parts;
  if (role === "billing" && kind !== "eips") fail(403, "FORBIDDEN");
  const json = (data: unknown, status = 200) =>
    HttpResponse.json(data as object, { status });
  const done = () => {
    persist();
    return new HttpResponse(null, { status: 204 });
  };
  const scope = (input: Record<string, unknown>) => {
    const value = z
      .object({ projectId: z.string(), region: z.enum(REGIONS) })
      .parse(input);
    if (!db.projects.some((p) => p.id === value.projectId && !p.deletedAt))
      fail(422, "VALIDATION_ERROR");
    ensureScope(n, value);
    return value;
  };
  const matches = (item: {
    region: Region;
    projectId: string;
    name?: string;
    deletedAt?: string | null;
  }) =>
    !item.deletedAt &&
    (!qs.get("region") || item.region === qs.get("region")) &&
    (!qs.get("project_id") || item.projectId === qs.get("project_id")) &&
    (!qs.get("q") ||
      (item.name || "").toLowerCase().includes(qs.get("q")!.toLowerCase()));
  const named = z.string().trim().min(2).max(63);
  const findVpc = (vpcId: string, s: { projectId: string; region: Region }) =>
    n.vpcs.find(
      (v) =>
        v.id === vpcId &&
        !v.deletedAt &&
        v.projectId === s.projectId &&
        v.region === s.region,
    ) || fail(409, "NETWORK_SCOPE_MISMATCH");
  const eipView = (e: ElasticIp) => ({
    ...e,
    hourly: e.releasedAt ? 0 : ipHourly(e.region),
    boundName: e.interfaceId
      ? n.interfaces.find((i) => i.id === e.interfaceId)?.name || null
      : e.tunnelId
        ? n.tunnels.find((t) => t.id === e.tunnelId)?.name || null
        : null,
  });
  const interfaces = n.interfaces.filter((i) => !i.releasedAt);
  if (kind === "quotas" && method === "GET") {
    const links = {
      vpc: "vpcs",
      subnet: "vpcs",
      security_group: "security-groups",
      tunnel: "tunnels",
      ip: "eips",
    };
    return json(
      REGIONS.filter(
        (region) => !qs.get("region") || region === qs.get("region"),
      ).flatMap((region) =>
        (["vpc", "subnet", "security_group", "tunnel", "ip"] as const).map(
          (metric) => {
            const usedValue =
              metric === "ip"
                ? used(region, "ip")
                : networkUsed(region, metric);
            const limitValue =
              metric === "ip"
                ? limits[region].ip
                : networkLimits[region][metric];
            return {
              region,
              metric,
              usedValue,
              limitValue,
              remaining: Math.max(0, limitValue - usedValue),
              href: `/network/${links[metric]}?region=${region}`,
            };
          },
        ),
      ),
    );
  }
  if (kind === "interfaces") {
    return json(
      interfaces
        .filter(
          (i) =>
            matches(i) &&
            (!qs.get("resource_id") ||
              i.resourceUuid === qs.get("resource_id")) &&
            (!qs.get("vpc_id") || i.vpcId === qs.get("vpc_id")) &&
            (!qs.get("group_id") ||
              i.securityGroupIds.includes(qs.get("group_id")!)),
        )
        .map((i) => ({
          ...i,
          resource: db.resources.find((r) => r.resourceUuid === i.resourceUuid),
          eip:
            n.eips.find((e) => !e.releasedAt && e.interfaceId === i.id) || null,
        })),
    );
  }
  if (kind === "vpcs") {
    if (!id) {
      if (method === "GET")
        return json(
          n.vpcs.filter(matches).map((v) => ({
            ...v,
            subnetCount: n.subnets.filter(
              (s) => !s.deletedAt && s.vpcId === v.id,
            ).length,
            interfaceCount: interfaces.filter((i) => i.vpcId === v.id).length,
          })),
        );
      if (method === "POST") {
        const s = scope(body);
        checkNetworkQuota(s.region, "vpc");
        const cidr = z.string().refine(validVpcCidr).parse(body.cidr);
        const v = {
          ...s,
          id: `vpc-${crypto.randomUUID().slice(0, 12)}`,
          name: named.parse(body.name),
          cidr,
          isDefault: false,
          createdAt: new Date().toISOString(),
        };
        const networkType = z
          .enum(["standard", "baremetal"])
          .default("standard")
          .parse(body.networkType);
        const createdVpc = { ...v, networkType };
        n.vpcs.push(createdVpc);
        networkAudit(n, s, v.id, "vpcCreate");
        persist();
        return json(createdVpc, 201);
      }
    }
    const v = n.vpcs.find((v) => v.id === id) || fail(404, "NOT_FOUND");
    if (v.deletedAt && method !== "GET") fail(410, "GONE");
    if (method === "GET")
      return json({
        ...v,
        subnets: n.subnets
          .filter((s) => s.vpcId === id && !s.deletedAt)
          .map((s) => ({
            ...s,
            usedIps: subnetUsed(n, s.id),
            availableIps: availableIps(n, s.id),
          })),
        groups: n.groups.filter((g) => g.vpcId === id && !g.deletedAt),
        interfaces: interfaces.filter((i) => i.vpcId === id),
        tunnels: n.tunnels.filter((t) => t.vpcId === id && !t.deletedAt),
        audit: n.audit.filter((a) => a.entityId === id),
      });
    if (method === "PATCH") {
      v.name = named.parse(body.name);
      networkAudit(n, v, v.id, "rename");
      persist();
      return json(v);
    }
    if (method === "DELETE") {
      if (v.isDefault) fail(409, "DEFAULT_NETWORK");
      if (
        n.subnets.some((s) => s.vpcId === id && !s.deletedAt) ||
        n.groups.some((g) => g.vpcId === id && !g.deletedAt) ||
        interfaces.some((i) => i.vpcId === id) ||
        n.tunnels.some((t) => t.vpcId === id && !t.deletedAt)
      )
        fail(409, "NETWORK_HAS_DEPENDENCIES");
      v.deletedAt = new Date().toISOString();
      networkAudit(n, v, v.id, "vpcDelete");
      return done();
    }
  }
  if (kind === "subnets") {
    if (!id) {
      if (method === "GET")
        return json(
          n.subnets
            .filter(
              (s) =>
                matches(s) &&
                (!qs.get("vpc_id") || s.vpcId === qs.get("vpc_id")),
            )
            .map((s) => ({
              ...s,
              usedIps: subnetUsed(n, s.id),
              availableIps: availableIps(n, s.id),
            })),
        );
      if (method === "POST") {
        const s = scope(body);
        checkNetworkQuota(s.region, "subnet");
        const vpc = findVpc(z.string().parse(body.vpcId), s);
        const cidr = z
          .string()
          .refine((c) => verifySubnet(vpc.cidr, c))
          .parse(body.cidr);
        if (
          n.subnets.some(
            (x) =>
              !x.deletedAt && x.vpcId === vpc.id && cidrOverlaps(x.cidr, cidr),
          )
        )
          fail(409, "CIDR_OVERLAP");
        const subnet = {
          ...s,
          id: `vsw-${crypto.randomUUID().slice(0, 12)}`,
          vpcId: vpc.id,
          name: named.parse(body.name),
          cidr,
          zone: z.enum([`${s.region}-a`, `${s.region}-b`]).parse(body.zone),
          createdAt: new Date().toISOString(),
        };
        n.subnets.push(subnet);
        networkAudit(n, s, vpc.id, "subnetCreate");
        persist();
        return json(subnet, 201);
      }
    }
    const s = n.subnets.find((s) => s.id === id) || fail(404, "NOT_FOUND");
    if (s.deletedAt && method !== "GET") fail(410, "GONE");
    if (method === "PATCH") {
      s.name = named.parse(body.name);
      persist();
      return json(s);
    }
    if (method === "DELETE") {
      if (subnetUsed(n, s.id) > 0) fail(409, "NETWORK_HAS_DEPENDENCIES");
      s.deletedAt = new Date().toISOString();
      networkAudit(n, s, s.vpcId, "subnetDelete");
      return done();
    }
  }
  if (kind === "security-groups") {
    if (!id) {
      if (method === "GET")
        return json(
          n.groups
            .filter(
              (g) =>
                matches(g) &&
                (!qs.get("vpc_id") || g.vpcId === qs.get("vpc_id")),
            )
            .map((g) => ({
              ...g,
              interfaceCount: interfaces.filter((i) =>
                i.securityGroupIds.includes(g.id),
              ).length,
            })),
        );
      if (method === "POST") {
        const s = scope(body);
        checkNetworkQuota(s.region, "security_group");
        const v = findVpc(z.string().parse(body.vpcId), s);
        const g = {
          ...s,
          id: `sg-${crypto.randomUUID().slice(0, 12)}`,
          vpcId: v.id,
          name: named.parse(body.name),
          description: z
            .string()
            .max(256)
            .parse(body.description || ""),
          isDefault: false,
          intraGroupPolicy: z
            .enum(["allow", "deny"])
            .parse(body.intraGroupPolicy || "allow"),
          rules: [] as SecurityRule[],
          createdAt: new Date().toISOString(),
        };
        n.groups.push(g);
        networkAudit(n, s, g.id, "groupCreate");
        persist();
        return json(g, 201);
      }
    }
    const g = n.groups.find((g) => g.id === id) || fail(404, "NOT_FOUND");
    if (g.deletedAt && method !== "GET") fail(410, "GONE");
    if (method === "GET")
      return json({
        ...g,
        interfaces: interfaces.filter((i) => i.securityGroupIds.includes(id)),
        audit: n.audit.filter((a) => a.entityId === id),
      });
    if (action === "rules") {
      if (method === "DELETE") {
        if (!g.rules.some((r) => r.id === ruleId)) fail(404, "NOT_FOUND");
        g.rules = g.rules.filter((r) => r.id !== ruleId);
        networkAudit(n, g, g.id, "ruleDelete");
        return done();
      }
      const parsed = z
        .object({
          direction: z.enum(["inbound", "outbound"]),
          action: z.enum(["allow", "deny"]),
          protocol: z.enum(["all", "tcp", "udp", "icmp"]),
          cidr: z.string().refine((c) => !!cidrRange(c)),
          portFrom: z.number().int().min(1).max(65535).nullable(),
          portTo: z.number().int().min(1).max(65535).nullable(),
          priority: z.number().int().min(1).max(100),
          description: z.string().max(256),
        })
        .parse(body);
      if (
        ["tcp", "udp"].includes(parsed.protocol)
          ? parsed.portFrom === null ||
            parsed.portTo === null ||
            parsed.portFrom > parsed.portTo
          : parsed.portFrom !== null || parsed.portTo !== null
      )
        fail(422, "VALIDATION_ERROR");
      if (method === "POST") {
        if (g.rules.length >= 100) fail(409, "NETWORK_LIMIT");
        const r = { ...parsed, id: crypto.randomUUID() };
        g.rules.push(r);
        networkAudit(n, g, g.id, "ruleCreate");
        persist();
        return json(r, 201);
      }
      if (method === "PATCH") {
        const old =
          g.rules.find((r) => r.id === ruleId) || fail(404, "NOT_FOUND");
        Object.assign(old, parsed);
        networkAudit(n, g, g.id, "ruleEdit");
        persist();
        return json(old);
      }
    }
    if (action === "associate" && method === "POST") {
      const r = resource(z.string().parse(body.resourceUuid));
      if (
        r.kind !== "gpu_vm" ||
        r.deletedAt ||
        r.projectId !== g.projectId ||
        r.region !== g.region ||
        r.spec.vpc !== g.vpcId
      )
        fail(409, "NETWORK_SCOPE_MISMATCH");
      const current = r.spec.securityGroups || [];
      const remove = body.remove === true;
      const ids = remove
        ? current.filter((id) => id !== g.id)
        : [...new Set([...current, g.id])];
      if (!ids.length || ids.length > 5) fail(422, "VALIDATION_ERROR");
      r.spec.securityGroups = ids;
      for (const nic of interfaces.filter(
        (i) => i.resourceUuid === r.resourceUuid,
      ))
        nic.securityGroupIds = ids;
      networkAudit(n, g, g.id, remove ? "groupDetach" : "groupAssociate");
      persist();
      return json(g);
    }
    if (method === "PATCH") {
      const parsed = z
        .object({
          name: named,
          description: z.string().max(256),
          intraGroupPolicy: z.enum(["allow", "deny"]),
        })
        .parse(body);
      Object.assign(g, parsed);
      networkAudit(n, g, g.id, "groupEdit");
      persist();
      return json(g);
    }
    if (method === "DELETE") {
      if (g.isDefault) fail(409, "DEFAULT_NETWORK");
      if (interfaces.some((i) => i.securityGroupIds.includes(g.id)))
        fail(409, "NETWORK_HAS_DEPENDENCIES");
      g.deletedAt = new Date().toISOString();
      networkAudit(n, g, g.id, "groupDelete");
      return done();
    }
  }
  if (kind === "eips") {
    if (!id) {
      if (method === "GET")
        return json(
          n.eips
            .filter(
              (e) =>
                matches(e) &&
                (!e.releasedAt || qs.get("includeReleased") === "true"),
            )
            .map(eipView),
        );
      if (method === "POST") {
        const s = scope(body);
        if (db.account.creditBalance < 0) fail(409, "INSUFFICIENT_BALANCE");
        if (used(s.region, "ip") >= limits[s.region].ip)
          fail(409, "QUOTA_EXCEEDED", { metric: "ip" });
        const e = allocateEip(
          n,
          s,
          named.parse(body.name),
          z.number().int().min(1).max(1000).parse(body.bandwidthMbps),
        );
        persist();
        return json(eipView(e), 201);
      }
    }
    const e = n.eips.find((e) => e.id === id) || fail(404, "NOT_FOUND");
    if (method === "GET")
      return json({
        ...eipView(e),
        audit: n.audit.filter((a) => a.entityId === id),
        usage: db.usage.filter((u) => u.resourceUuid === id),
      });
    if (e.releasedAt) fail(410, "GONE");
    if (action === "bind" && method === "POST") {
      if (e.interfaceId || e.tunnelId) fail(409, "EIP_IN_USE");
      const nic =
        interfaces.find((i) => i.id === body.interfaceId) ||
        fail(404, "NOT_FOUND");
      const r = resource(nic.resourceUuid);
      if (
        r.kind !== "gpu_vm" ||
        !["running", "stopped"].includes(r.status) ||
        r.region !== e.region ||
        r.projectId !== e.projectId
      )
        fail(409, "NETWORK_SCOPE_MISMATCH");
      if (n.eips.some((x) => !x.releasedAt && x.interfaceId === nic.id))
        fail(409, "EIP_IN_USE");
      e.interfaceId = nic.id;
      r.spec.publicIp = true;
      networkAudit(n, e, e.id, "eipBind");
      persist();
      return json(eipView(e));
    }
    if (action === "unbind" && method === "POST") {
      if (e.tunnelId) fail(409, "NETWORK_HAS_DEPENDENCIES");
      const nic = n.interfaces.find((i) => i.id === e.interfaceId);
      e.interfaceId = null;
      if (nic) {
        const r = resource(nic.resourceUuid);
        r.spec.publicIp = n.eips.some(
          (x) =>
            !x.releasedAt &&
            n.interfaces.some(
              (i) =>
                i.id === x.interfaceId && i.resourceUuid === r.resourceUuid,
            ),
        );
        delete r.spec.eipId;
      }
      networkAudit(n, e, e.id, "eipUnbind");
      persist();
      return json(eipView(e));
    }
    if (method === "PATCH") {
      const name = named.parse(body.name);
      const bandwidthMbps = z
        .number()
        .int()
        .min(1)
        .max(1000)
        .parse(body.bandwidthMbps);
      Object.assign(e, { name, bandwidthMbps });
      networkAudit(n, e, e.id, "eipEdit");
      persist();
      return json(eipView(e));
    }
    if (method === "DELETE") {
      if (e.interfaceId || e.tunnelId) fail(409, "EIP_IN_USE");
      if (qs.get("confirm") !== e.displayId) fail(422, "CONFIRM_MISMATCH");
      e.releasedAt = new Date().toISOString();
      networkAudit(n, e, e.id, "eipRelease");
      persist();
      return json(eipView(e));
    }
  }
  if (kind === "tunnels") {
    if (!id) {
      if (method === "GET")
        return json(
          n.tunnels.filter(matches).map((t) => ({
            ...t,
            gatewayIp: n.eips.find((e) => e.id === t.eipId)?.address || null,
          })),
        );
      if (method === "POST") {
        const s = scope(body);
        checkNetworkQuota(s.region, "tunnel");
        const v = findVpc(z.string().parse(body.vpcId), s);
        const subnet =
          n.subnets.find(
            (x) => x.id === body.subnetId && !x.deletedAt && x.vpcId === v.id,
          ) || fail(409, "NETWORK_SCOPE_MISMATCH");
        const e =
          n.eips.find(
            (e) =>
              e.id === body.eipId &&
              !e.releasedAt &&
              e.region === s.region &&
              e.projectId === s.projectId &&
              !e.interfaceId &&
              !e.tunnelId,
          ) || fail(409, "EIP_NOT_AVAILABLE");
        const peerIp = z.string().refine(isPublicIpv4).parse(body.peerIp);
        if (peerIp === e.address) fail(422, "VALIDATION_ERROR");
        const localCidr = z
          .string()
          .refine((c) => cidrContains(v.cidr, c))
          .parse(body.localCidr);
        const remoteCidr = z
          .string()
          .refine((c) => !!cidrRange(c))
          .parse(body.remoteCidr);
        if (
          cidrOverlaps(v.cidr, remoteCidr) ||
          n.tunnels.some(
            (t) =>
              !t.deletedAt &&
              t.vpcId === v.id &&
              cidrOverlaps(t.remoteCidr, remoteCidr),
          )
        )
          fail(409, "CIDR_OVERLAP");
        z.string().min(16).max(128).parse(body.psk);
        if (availableIps(n, subnet.id) < 1) fail(409, "SUBNET_EXHAUSTED");
        const t: IpsecTunnel = {
          ...s,
          id: `vpn-${crypto.randomUUID().slice(0, 12)}`,
          name: named.parse(body.name),
          vpcId: v.id,
          subnetId: subnet.id,
          eipId: e.id,
          privateIp: nextPrivateIp(n, subnet.id),
          peerIp,
          localCidr,
          remoteCidr,
          ikeVersion: "ikev2",
          encryption: "aes256",
          integrity: "sha256",
          pskConfigured: true,
          enabled: false,
          createdAt: new Date().toISOString(),
        };
        n.tunnels.push(t);
        e.tunnelId = t.id;
        networkAudit(n, s, t.id, "tunnelCreate");
        persist();
        return json(t, 201);
      }
    }
    const t = n.tunnels.find((t) => t.id === id) || fail(404, "NOT_FOUND");
    if (t.deletedAt && method !== "GET") fail(410, "GONE");
    if (method === "GET")
      return json({
        ...t,
        gatewayIp: n.eips.find((e) => e.id === t.eipId)?.address || null,
        audit: n.audit.filter((a) => a.entityId === id),
      });
    if (method === "PATCH") {
      const parsed = z
        .object({
          enabled: z.boolean().optional(),
          name: named.optional(),
          psk: z.string().min(16).max(128).optional(),
        })
        .parse(body);
      if (parsed.enabled !== undefined) t.enabled = parsed.enabled;
      if (parsed.name !== undefined) t.name = parsed.name;
      if (parsed.psk !== undefined) t.pskConfigured = true;
      networkAudit(
        n,
        t,
        t.id,
        parsed.enabled !== undefined
          ? t.enabled
            ? "tunnelEnable"
            : "tunnelDisable"
          : "tunnelEdit",
      );
      persist();
      return json(t);
    }
    if (method === "DELETE") {
      if (t.enabled) fail(409, "INVALID_STATE");
      const e = n.eips.find((e) => e.id === t.eipId);
      if (e) e.tunnelId = null;
      t.deletedAt = new Date().toISOString();
      networkAudit(n, t, t.id, "tunnelDelete");
      return done();
    }
  }
  fail(404, "NOT_FOUND");
}

function normalizeTicket(ticket: Ticket): Ticket {
  ticket.caseNumber = formatResourceId("tkt", ticket.id);
  ticket.category ||= "technical";
  ticket.context ||= {};
  ticket.updatedAt ||= ticket.messages.at(-1)?.at || ticket.createdAt;
  ticket.region ||= ticket.resourceUuid
    ? db.resources.find(
        (resource) => resource.resourceUuid === ticket.resourceUuid,
      )?.region || null
    : null;
  ticket.resolvedAt ||= null;
  ticket.resolution ||= "";
  ticket.messages = (ticket.messages || []).map((message) => ({
    ...message,
    attachments: message.attachments || [],
  }));
  ticket.events ||= [
    {
      id: `legacy-created-${ticket.id}`,
      type: "created",
      actor: ticket.messages[0]?.actor || "enzoOvOyu",
      at: ticket.createdAt,
      status: ticket.status === "closed" ? "closed" : "open",
      summary: "tickets.eventCreated",
    },
  ];
  return ticket;
}

async function storeTicketAttachments(
  ticketId: string,
  input: unknown,
): Promise<TicketAttachment[]> {
  const files = z
    .array(
      z.object({
        name: z.string().trim().min(1).max(180),
        size: z.number().int().min(1).max(5_000_000),
        contentType: z.string().min(1).max(120),
        content: z.string().max(6_800_000),
      }),
    )
    .max(5)
    .parse(input || []);
  const now = new Date().toISOString();
  const attachments: TicketAttachment[] = [];
  for (const file of files) {
    if (!file.content.startsWith(`data:${file.contentType};base64,`))
      fail(422, "INVALID_ATTACHMENT");
    const id = crypto.randomUUID();
    const key = `ticket/${ticketId}/${id}`;
    await putObject(key, file.content);
    attachments.push({
      id,
      name: file.name,
      size: file.size,
      contentType: file.contentType,
      key,
      uploadedAt: now,
      uploadedBy: "enzoOvOyu",
    });
  }
  return attachments;
}

async function dispatch(request: Request, settleBilling = true) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const qs = url.searchParams;
  const role = (request.headers.get("X-Role") || "owner") as Role;
  if (!ROLES.includes(role)) fail(403, "FORBIDDEN");
  const isConsoleLogin = /^\/api\/resources\/[^/]+\/console-login$/.test(path);
  if (method !== "GET" && !isConsoleLogin && !canWrite(role))
    fail(403, "FORBIDDEN");
  const body: Record<string, unknown> =
    method === "GET" || method === "DELETE"
      ? {}
      : ((await request.json()) as Record<string, unknown>);
  const json = (data: unknown, status = 200) =>
    HttpResponse.json(data as object, { status });
  const done = () => {
    persist();
    return new HttpResponse(null, { status: 204 });
  };
  const region = qs.get("region");
  if (region && !REGIONS.includes(region as Region))
    fail(422, "VALIDATION_ERROR");
  tick(settleBilling);
  const consoleLoginMatch = path.match(
    /^\/api\/resources\/([^/]+)\/console-login$/,
  );
  if (consoleLoginMatch && method === "POST") {
    const target = resource(consoleLoginMatch[1]);
    if (target.kind !== "gpu_vm") fail(404, "NOT_FOUND");
    if (target.status !== "running") fail(409, "INVALID_STATE");
    if (target.spec.authMethod !== "password")
      fail(409, "PASSWORD_AUTH_NOT_CONFIGURED");
    const username = z.literal("root").parse(body.username);
    const password = z.string().min(1).max(128).parse(body.password);
    const expected = db.consolePasswordFingerprints[target.resourceUuid];
    if (
      !expected ||
      consolePasswordFingerprint(target.resourceUuid, password) !== expected
    )
      fail(401, "INVALID_CREDENTIALS");
    return json({ username });
  }
  if (path.startsWith("/api/network/"))
    return dispatchNetwork(path, method, qs, body, role);
  if (path === "/api/deployment-options") {
    const code = (region || "jp") as Region;
    const projectId = qs.get("project_id") || "default";
    if (!db.projects.some((p) => p.id === projectId && !p.deletedAt))
      fail(422, "VALIDATION_ERROR");
    ensureScope(db.network, { projectId, region: code });
    const requestedKind = qs.get("kind");
    const requestedVpcType =
      requestedKind === "gpu_baremetal" ? "baremetal" : "standard";
    return json({
      vpcs: db.network.vpcs
        .filter(
          (v) =>
            !v.deletedAt &&
            v.projectId === projectId &&
            v.region === code &&
            (!requestedKind || vpcNetworkType(v) === requestedVpcType),
        )
        .map((v) => ({
          ...v,
          subnets: db.network.subnets
            .filter((s) => !s.deletedAt && s.vpcId === v.id)
            .map((s) => ({
              ...s,
              availableIps: availableIps(db.network, s.id),
            })),
        })),
      securityGroups: db.network.groups.filter(
        (g) => !g.deletedAt && g.projectId === projectId && g.region === code,
      ),
      eips: db.network.eips.filter(
        (e) =>
          e.projectId === projectId &&
          e.region === code &&
          !e.releasedAt &&
          !e.interfaceId &&
          !e.tunnelId,
      ),
      k8sVersions: ["1.28", "1.29", "1.30", "1.31"],
    });
  }
  if (path === "/api/storage/products") return json(STORAGE_PRODUCTS);
  if (path === "/api/storage/volumes") {
    if (method === "GET")
      return json(
        db.volumes
          .filter(
            (volume) =>
              !volume.deletedAt &&
              (!region || volume.region === region) &&
              (!qs.get("project_id") ||
                volume.projectId === qs.get("project_id")),
          )
          .map((volume) => {
            const attached = db.resources.find(
              (r) => r.resourceUuid === volume.resourceUuid,
            );
            return {
              ...volume,
              resourceName: attached?.name || "",
              resourceKind: attached?.kind || null,
            };
          }),
      );
    if (method === "POST") {
      const kind = z.enum(["block", "file"]).parse(body.kind);
      const tier = z.string().parse(body.tier);
      const product = STORAGE_PRODUCTS.find(
        (item) => item.kind === kind && item.tier === tier,
      );
      if (!product) fail(422, "VALIDATION_ERROR");
      const sizeGb = z.number().int().parse(body.sizeGb);
      if (
        sizeGb < product.minGb ||
        sizeGb > product.maxGb ||
        sizeGb % product.stepGb !== 0
      )
        fail(422, "VALIDATION_ERROR");
      const code = z.enum(REGIONS).parse(body.region);
      const projectId = z.string().min(1).parse(body.projectId);
      if (
        !db.projects.some(
          (project) => project.id === projectId && !project.deletedAt,
        )
      )
        fail(422, "VALIDATION_ERROR");
      const name = z.string().trim().min(3).max(63).parse(body.name);
      if (
        db.volumes.some(
          (volume) =>
            !volume.deletedAt &&
            volume.region === code &&
            volume.projectId === projectId &&
            volume.name === name,
        )
      )
        fail(422, "VALIDATION_ERROR");
      const allocation = storageQuotaBreakdown(code).find(
        (item) => item.kind === kind,
      );
      if (allocation && allocation.usedGb + sizeGb > allocation.limitGb)
        fail(409, "QUOTA_EXCEEDED", {
          metric: "storage",
          limit: allocation.limitGb,
          used: allocation.usedGb,
          requested: sizeGb,
        });
      const volume = {
        id: crypto.randomUUID(),
        name,
        kind,
        tier,
        role: "custom" as const,
        sizeGb,
        projectId,
        region: code,
        resourceUuid: null,
        mountPath: "",
        createdAt: new Date().toISOString(),
        deletedAt: null,
      };
      db.volumes.push(volume);
      persist();
      return json(volume, 201);
    }
  }
  const volumeActionMatch = path.match(
    /^\/api\/storage\/volumes\/([^/]+)\/(attach|detach)$/,
  );
  if (volumeActionMatch && method === "POST") {
    if (!canWrite(role)) fail(403, "FORBIDDEN");
    const volume =
      db.volumes.find(
        (item) => item.id === volumeActionMatch[1] && !item.deletedAt,
      ) || fail(404, "NOT_FOUND");
    if (volume.role !== "custom") fail(409, "HAS_DEPENDENCIES");
    const action = volumeActionMatch[2];
    if (action === "attach") {
      if (volume.resourceUuid) fail(409, "HAS_DEPENDENCIES");
      const resourceUuid = z.string().min(1).parse(body.resourceUuid);
      const mountPath = z
        .string()
        .trim()
        .regex(/^\/[A-Za-z0-9/._-]+$/)
        .max(240)
        .parse(body.mountPath);
      const target =
        db.resources.find(
          (item) => item.resourceUuid === resourceUuid && !item.deletedAt,
        ) || fail(404, "NOT_FOUND");
      if (
        target.projectId !== volume.projectId ||
        target.region !== volume.region ||
        (volume.kind === "block"
          ? target.kind !== "gpu_vm"
          : !["gpu_vm", "inference", "vgpu"].includes(target.kind))
      )
        fail(422, "VALIDATION_ERROR");
      const selections = target.spec.storageSelections || [];
      if (selections.some((row) => row.mountPath === mountPath))
        fail(409, "VALIDATION_ERROR");
      target.spec.storageSelections = [
        ...selections,
        {
          key: `attached_${volume.id}`,
          kind: volume.kind,
          tier: volume.tier,
          name: volume.name,
          sizeGb: volume.sizeGb,
          count: 1,
          mountPath,
        },
      ];
      target.spec.storageGb += volume.sizeGb;
      volume.resourceUuid = target.resourceUuid;
      volume.mountPath = mountPath;
    } else {
      if (!volume.resourceUuid) fail(409, "HAS_DEPENDENCIES");
      const target = db.resources.find(
        (item) => item.resourceUuid === volume.resourceUuid,
      );
      if (target) {
        target.spec.storageSelections = (
          target.spec.storageSelections || []
        ).filter((row) => row.key !== `attached_${volume.id}`);
        target.spec.storageGb = Math.max(
          0,
          target.spec.storageGb - volume.sizeGb,
        );
      }
      volume.resourceUuid = null;
      volume.mountPath = "";
    }
    persist();
    return json(volume);
  }
  const volumeMatch = path.match(/^\/api\/storage\/volumes\/([^/]+)$/);
  if (volumeMatch) {
    const volume =
      db.volumes.find((v) => v.id === volumeMatch[1] && !v.deletedAt) ||
      fail(404, "NOT_FOUND");
    if (method === "DELETE") {
      if (volume.resourceUuid || volume.role !== "custom")
        fail(409, "HAS_DEPENDENCIES");
      volume.deletedAt = new Date().toISOString();
      return done();
    }
    if (method === "GET") {
      const attached = db.resources.find(
        (r) => r.resourceUuid === volume.resourceUuid,
      );
      return json({
        ...volume,
        resourceName: attached?.name || "",
        resourceKind: attached?.kind || null,
      });
    }
  }
  if (path === "/api/account") {
    if (method === "PATCH") {
      if (!canManageOrg(role)) fail(403, "FORBIDDEN");
      const budget = z.number().positive().parse(body.budget);
      db.account.budget = budget;
      persist();
    }
    return json(db.account);
  }
  if (path === "/api/billing/rates")
    return json(RATES.filter((r) => !region || r.region === region));
  if (path === "/api/node-pools")
    return json(catalogFor((region || "jp") as Region));
  if (path === "/api/quotas")
    return json(quotas().filter((q) => !region || q.region === region));
  if (path === "/api/overview") {
    const rs = live();
    return json({
      ...summary(null, new Date().toISOString().slice(0, 7)),
      resources: rs,
      distribution: REGIONS.flatMap((region) =>
        KINDS.map((kind) => {
          const rows = rs.filter((r) => r.region === region && r.kind === kind);
          return {
            region,
            kind,
            gpuCount: rows.reduce((n, r) => n + quotaUse(r, "gpu"), 0),
            unitCount: rows.reduce(
              (n, r) =>
                n +
                (r.kind === "gpu_vm"
                  ? r.spec.quantity
                  : r.kind === "gpu_baremetal"
                    ? r.spec.machineCount
                    : r.kind === "inference"
                      ? r.spec.replicas
                      : 1),
              0,
            ),
            nodeCount: rows.reduce(
              (n, r) =>
                n +
                (r.kind === "vgpu"
                  ? r.spec.nodePools.reduce((a, p) => a + p.nodeCount, 0)
                  : 0),
              0,
            ),
          };
        }),
      ),
      quotas: quotas(),
      events: db.events
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 10),
      alerts: rs
        .filter((r) => r.status === "error")
        .map((r) => ({ id: r.resourceUuid, type: "error", resource: r })),
      projects: db.projects.map((p) => ({ id: p.id, name: p.name })),
      account: db.account,
    });
  }
  if (path === "/api/billing/summary")
    return json(
      summary(
        region,
        qs.get("billing_period") || new Date().toISOString().slice(0, 7),
        qs.get("resource_id"),
      ),
    );
  if (path === "/api/events")
    return json(
      db.events
        .filter(
          (e) =>
            !qs.get("resource_id") || e.resourceUuid === qs.get("resource_id"),
        )
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  if (path === "/api/operations") {
    const now = Date.now();
    const operations = db.resources.flatMap((r) => {
      const history = db.events.filter(
        (event) => event.resourceUuid === r.resourceUuid,
      );
      const deletedEvent = history.find((event) => event.type === "deleted");
      const readyEvent = history.find((event) => event.type === "ready");
      const failedEvent = history.find((event) => event.type === "failed");
      const creationCanceled = deletedEvent?.before === "provisioning";
      const createStatus = creationCanceled
        ? "canceled"
        : r.status === "provisioning"
          ? "processing"
          : r.status === "error" || failedEvent
            ? "failed"
            : "succeeded";
      const expectedReadyAt = new Date(
        new Date(r.createdAt).getTime() +
          provisioningSeconds(r, db.models) * 1000,
      ).toISOString();
      const createCompletedAt =
        createStatus === "processing"
          ? null
          : creationCanceled
            ? deletedEvent.at
            : createStatus === "failed"
              ? failedEvent?.at || r.stoppedAt || expectedReadyAt
              : r.runningSince || readyEvent?.at || expectedReadyAt;
      const rows = [
        {
          id: `create-${r.resourceUuid}`,
          operation: "create",
          status: createStatus,
          startedAt: r.createdAt,
          completedAt: createCompletedAt,
        },
      ];
      if (r.deletedAt) {
        const at = deletedEvent?.at || r.deletedAt;
        rows.push({
          id: `delete-${r.resourceUuid}`,
          operation: "delete",
          status: "succeeded",
          startedAt: at,
          completedAt: at,
        });
      }
      const lifecycleOperations = history
        .filter((event) => event.action === "start" || event.action === "stop")
        .map((event) => ({
          id: event.action + "-" + event.id,
          operation: event.action as "start" | "stop",
          status: "succeeded" as const,
          startedAt: event.at,
          completedAt: event.at,
        }));
      rows.push(...lifecycleOperations);
      return rows.map((operation) => {
        const start = Date.parse(operation.startedAt);
        const end = operation.completedAt
          ? Date.parse(operation.completedAt)
          : now;
        return {
          ...operation,
          resourceUuid: r.resourceUuid,
          displayId: r.displayId,
          resourceName: r.name,
          projectId: r.projectId,
          projectName:
            db.projects.find((project) => project.id === r.projectId)?.name ||
            r.projectId,
          region: r.region,
          kind: r.kind,
          elapsedSeconds: Math.max(0, Math.floor((end - start) / 1000)),
        };
      });
    });
    return json(
      operations.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    );
  }
  if (path === "/api/notifications") {
    const items: {
      id: string;
      resource?: Resource;
      messageKey?: string;
      href?: string;
      read: boolean;
    }[] = live()
      .filter((r) => r.status === "error")
      .map((r) => ({ id: r.resourceUuid, resource: r, read: false }));
    if (db.account.creditBalance < db.account.lowBalanceThresholdUsd)
      items.push({
        id: "balance",
        messageKey: "billing.lowBalance",
        href: role === "member" ? "/ops/tickets?new=balance" : "/billing/bills",
        read: false,
      });
    if (db.account.depletedAt)
      items.push({
        id: "grace",
        messageKey: "billing.grace",
        href: role === "member" ? "/ops/tickets?new=balance" : "/billing/bills",
        read: false,
      });
    return json(items);
  }
  if (path === "/api/resources" && method === "GET") {
    let rows = db.resources.filter(
      (r) =>
        (!r.deletedAt || qs.get("includeDeleted") === "true") &&
        (!region || r.region === region) &&
        (!qs.get("kind") || r.kind === qs.get("kind")) &&
        (!qs.get("project_id") || r.projectId === qs.get("project_id")) &&
        (!qs.get("status") || r.status === qs.get("status")),
    );
    const q = (qs.get("q") || "").toLowerCase();
    rows = rows.filter((r) =>
      [r.name, r.displayId, r.resourceUuid].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
    rows.sort((a, b) =>
      qs.get("sort") === "name"
        ? a.name.localeCompare(b.name)
        : b.createdAt.localeCompare(a.createdAt),
    );
    const size = Math.min(1000, Math.max(1, Number(qs.get("size") || 20)));
    const page = Math.max(1, Number(qs.get("page") || 1));
    return HttpResponse.json(
      {
        items: rows.slice((page - 1) * size, page * size).map(enrich),
        total: rows.length,
        page,
        size,
        regionScope: region || "all",
      },
      { headers: { "X-Total-Count": String(rows.length) } },
    );
  }
  const rm = path.match(/^\/api\/resources\/([^/]+)(?:\/(.+))?$/);
  if (rm) {
    const r = resource(rm[1]);
    const action = rm[2];
    if (method === "GET") {
      if (!action) {
        const data = {
          ...enrich(r),
          owner: { id: db.account.user, name: db.account.user },
          project: db.projects.find((p) => p.id === r.projectId),
          order: db.orders.find((o) => o.resourceUuid === r.resourceUuid),
        };
        if (r.deletedAt)
          return HttpResponse.json(
            { code: "GONE", resource: data },
            { status: 410 },
          );
        return json(data);
      }
      if (action === "network")
        return json({
          interfaces: db.network.interfaces
            .filter((i) => i.resourceUuid === r.resourceUuid)
            .map((i) => ({
              ...i,
              vpc: db.network.vpcs.find((v) => v.id === i.vpcId),
              subnet: db.network.subnets.find((s) => s.id === i.subnetId),
              groups: db.network.groups.filter((g) =>
                i.securityGroupIds.includes(g.id),
              ),
              eip:
                db.network.eips.find(
                  (e) => !e.releasedAt && e.interfaceId === i.id,
                ) || null,
            })),
        });
      if (action === "machines") {
        if (r.kind !== "gpu_baremetal") fail(404, "NOT_FOUND");
        return json(baremetalMachines(r));
      }
      if (action === "governance") {
        if (r.kind !== "inference") fail(404, "NOT_FOUND");
        const model = db.models.find((m) => m.id === r.spec.modelRef);
        const policy = db.policies.find(
          (p) => p.resourceUuid === r.resourceUuid,
        );
        const active = r.status === "running" && !r.deletedAt;
        const data: InferenceGovernance = {
          resourceUuid: r.resourceUuid,
          endpoint: `https://${r.displayId}.${r.region}.runsun.cloud`,
          modelRef: r.spec.modelRef,
          modelName: model?.name || r.spec.modelRef,
          authEnabled: r.spec.authEnabled,
          active,
          ...governanceSettings(r),
          versions: (["stable", "canary"] as const).map((id) => ({
            id,
            version: `${r.spec.modelRef}-${id === "stable" ? "v1" : "v2"}`,
            modelRef: r.spec.modelRef,
            engine: r.spec.engine,
            trafficPercent:
              id === "canary"
                ? r.spec.canaryPercent
                : 100 - r.spec.canaryPercent,
            ready: active,
          })),
          scalingPolicy: policy
            ? { id: policy.id, status: policy.status, config: policy.config }
            : null,
        };
        return json(data);
      }
      if (action === "logs") {
        if (r.status !== "running" && r.status !== "error") return json([]);
        return json(
          Array.from({ length: 20 }, (_, i) => ({
            ts: new Date(Date.now() - (20 - i) * 12000).toISOString(),
            level: i === 13 ? "error" : i === 7 ? "warning" : "info",
            requestId: `req-${r.displayId}-${Math.floor(Date.now() / 60000)}-${i}`,
            route: "/v1/chat/completions",
            status: i === 13 ? 500 : 200,
            latencyMs: i === 13 ? 6040 : 480 + i * 23,
            promptTokens: 128 + i * 64,
            genTokens: 32 + i * 9,
            cacheHit: i % 3 === 0,
            ...(i === 13
              ? {
                  trace:
                    "Traceback: KV cache allocation failed; reduce max_model_len or add replicas",
                }
              : {}),
          })),
        );
      }
      if (action === "access") {
        if (r.status !== "running") fail(409, "INVALID_STATE");
        return json({
          privateIp:
            db.network.interfaces.find(
              (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
            )?.privateIp || "—",
          publicIp:
            db.network.eips.find(
              (e) =>
                !e.releasedAt &&
                db.network.interfaces.some(
                  (i) =>
                    i.id === e.interfaceId &&
                    i.resourceUuid === r.resourceUuid &&
                    !i.releasedAt,
                ),
            )?.address || null,
          ssh: `ssh ubuntu@${db.network.interfaces.find((i) => i.resourceUuid === r.resourceUuid && !i.releasedAt)?.privateIp || "—"}`,
          endpoint: `https://${r.displayId}.${r.region}.runsun.cloud`,
          bmc: { ip: "10.255.0.10", firmware: "2.14.0", reachable: true },
          ...hardwareSnapshot(r).firmware,
        });
      }
      if (action === "steps") {
        const names =
          r.kind === "gpu_baremetal"
            ? ["allocation", "network", "bmc", "os", "driver", "ready"]
            : r.kind === "vgpu"
              ? ["allocation", "controlplane", "network", "plugins", "ready"]
              : r.kind === "inference"
                ? ["allocation", "network", "image", "weights", "ready"]
                : ["allocation", "network", "image", "driver", "ready"];
        const duration = provisioningSeconds(r, db.models);
        const progress =
          r.status === "running"
            ? 1
            : Math.min(
                0.95,
                (Date.now() -
                  new Date(r.provisioningSince || r.createdAt).getTime()) /
                  (duration * 1000),
              );
        return json(
          names.map((name, i) => ({
            name,
            durationS: duration / names.length,
            etaS: Math.max(
              0,
              Math.ceil(
                duration -
                  (Date.now() -
                    new Date(r.provisioningSince || r.createdAt).getTime()) /
                    1000,
              ),
            ),
            overallProgress: Math.round(progress * 100),
            status: r.deletedAt
              ? "skipped"
              : r.status === "running" ||
                  i < Math.floor(progress * names.length)
                ? "success"
                : i ===
                    Math.min(
                      names.length - 1,
                      Math.floor(progress * names.length),
                    )
                  ? "in_progress"
                  : "pending",
          })),
        );
      }
    }
    if (method === "DELETE") {
      if (r.deletedAt) fail(409, "ALREADY_DELETED");
      if (r.status === "terminating") fail(409, "INVALID_STATE");
      if (qs.get("confirm") !== r.displayId && qs.get("confirm") !== r.name)
        fail(422, "CONFIRM_MISMATCH");
      const dependencies = db.notebooks.filter(
        (n) => n.resourceUuid === r.resourceUuid,
      );
      if (dependencies.length)
        fail(423, "HAS_DEPENDENCIES", {
          dependencies: dependencies.map((n) => ({
            name: n.name,
            href: "/workbench/notebooks",
          })),
        });
      const before = r.status;
      settle(r);
      releaseResourceNetwork(db.network, r.resourceUuid);
      delete db.consolePasswordFingerprints[r.resourceUuid];
      r.deletedAt = new Date().toISOString();
      for (const volume of db.volumes)
        if (volume.resourceUuid === r.resourceUuid)
          volume.deletedAt = r.deletedAt;
      for (const bucket of db.buckets)
        if (bucket.attachedResourceUuid === r.resourceUuid) {
          bucket.attachedResourceUuid = null;
          bucket.references = bucket.references.filter(
            (reference) => reference.href !== resourceLink(r),
          );
        }
      r.status = "terminating";
      r.runningSince = null;
      db.policies = db.policies.filter(
        (p) => p.resourceUuid !== r.resourceUuid,
      );
      addEvent(r, "deleted", before, "terminating");
      persist();
      return json(r);
    }
    if (method === "POST" && action) {
      if (r.deletedAt) fail(410, "GONE");
      const before = r.status;
      const governanceBefore =
        r.kind === "inference" ? JSON.stringify(governanceSettings(r)) : "";
      let resizePreviousCount: number | null = null;
      if (action === "start") {
        if (r.status !== "stopped") fail(409, "INVALID_STATE");
        precheck(r, r.resourceUuid);
        r.status = "running";
        r.runningSince = new Date().toISOString();
        r.stoppedAt = null;
      } else if (action === "stop") {
        if (r.status !== "running") fail(409, "INVALID_STATE");
        r.status = "stopped";
        r.stoppedAt = new Date().toISOString();
        r.runningSince = null;
      } else if (action === "restart") {
        if (r.status !== "running") fail(409, "INVALID_STATE");
        r.runningSince = new Date().toISOString();
      } else if (action === "retry") {
        if (r.status !== "error") fail(409, "INVALID_STATE");
        precheck(r, r.resourceUuid);
        r.status = "provisioning";
        r.provisioningSince = new Date().toISOString();
        const order = db.orders.find((o) => o.resourceUuid === r.resourceUuid);
        if (order) order.status = "provisioning";
      } else if (action === "reset-password") {
        if (r.kind !== "gpu_vm") fail(404, "NOT_FOUND");
        const credential = `RunSun-${crypto.randomUUID()}`;
        r.spec.authMethod = "password";
        db.consolePasswordFingerprints[r.resourceUuid] =
          consolePasswordFingerprint(r.resourceUuid, credential);
        persist();
        return json({ credential });
      } else if (action === "rescue" || action === "reset-os") {
        if (r.kind !== "gpu_baremetal" || r.status !== "stopped")
          fail(409, "INVALID_STATE");
        r.status = "provisioning";
        r.provisioningSince = new Date().toISOString();
        const order = db.orders.find((o) => o.resourceUuid === r.resourceUuid);
        if (order) order.status = "provisioning";
      } else if (action === "no-gpu") {
        if (r.kind !== "gpu_vm" || r.status !== "stopped")
          fail(409, "INVALID_STATE");
        r.spec.gpuDisabled = !r.spec.gpuDisabled;
        r.spec.gpuCount = r.spec.gpuDisabled
          ? 0
          : r.spec.gpuPerInstance * r.spec.quantity;
      } else if (action === "cordon" || action === "uncordon") {
        if (r.kind !== "vgpu" || r.status !== "running")
          fail(422, "VALIDATION_ERROR");
        const nodeUuid = z.string().min(1).parse(body.nodeUuid);
        const match = nodeUuid.match(
          new RegExp(`^${r.resourceUuid}-(\\d+)-(\\d+)$`),
        );
        if (!match) fail(422, "INVALID_NODE_TARGET");
        const poolIndex = Number(match[1]);
        const nodeIndex = Number(match[2]);
        const pool = r.spec.nodePools[poolIndex];
        if (!pool || nodeIndex < 0 || nodeIndex >= pool.nodeCount)
          fail(404, "NODE_NOT_FOUND");
        const nodeLabel = `cluster-node:${nodeUuid}:cordoned`;
        const isCordon = r.labels.includes(nodeLabel);
        if (
          (action === "cordon" && isCordon) ||
          (action === "uncordon" && !isCordon)
        )
          fail(409, "INVALID_NODE_STATE");
        r.labels =
          action === "cordon"
            ? [...r.labels, nodeLabel]
            : r.labels.filter((label) => label !== nodeLabel);
      } else if (action === "governance") {
        if (r.kind !== "inference") fail(404, "NOT_FOUND");
        if (r.status !== "running") fail(409, "INVALID_STATE");
        const settings = inferenceGovernanceSchema.parse(body);
        r.spec.canaryPercent = settings.canaryPercent;
        r.spec.gateway = {
          qpsLimit: settings.qpsLimit,
          timeoutMs: settings.timeoutMs,
        };
      } else if (action === "traffic") {
        if (r.kind !== "inference") fail(422, "VALIDATION_ERROR");
        if (r.status !== "running") fail(409, "INVALID_STATE");
        r.spec.canaryPercent =
          inferenceGovernanceSchema.shape.canaryPercent.parse(body.percent);
      } else if (action === "restart-replica") {
        if (r.kind !== "inference" || r.status !== "running")
          fail(409, "INVALID_STATE");
        const index = z
          .number()
          .int()
          .min(0)
          .max(r.spec.replicas - 1)
          .parse(body.index);
        db.replicaRestarts[r.resourceUuid] ??= {};
        db.replicaRestarts[r.resourceUuid][String(index)] =
          (db.replicaRestarts[r.resourceUuid][String(index)] || 0) + 1;
      } else if (action === "resize") {
        const count = z
          .number()
          .int()
          .min(1)
          .max(r.kind === "vgpu" ? 64 : 32)
          .parse(body.count);
        if (r.kind === "inference") {
          const next = {
            ...r,
            spec: {
              ...r.spec,
              replicas: count,
              gpuCount: count * r.spec.gpuPerReplica,
            },
          };
          precheck(next, r.resourceUuid);
          r.spec = next.spec;
        } else if (r.kind === "vgpu") {
          const next = structuredClone(r);
          const poolIndex = z
            .number()
            .int()
            .min(0)
            .max(next.spec.nodePools.length - 1)
            .parse(body.poolIndex);
          resizePreviousCount = next.spec.nodePools[poolIndex].nodeCount;
          next.spec.nodePools[poolIndex].nodeCount = z
            .number()
            .int()
            .min(1)
            .max(64)
            .parse(body.count);
          next.spec.nodePools[poolIndex].gpuPerNode =
            GPU_SPECS[next.spec.nodePools[poolIndex].poolCode].gpusPerNode;
          next.spec.gpuCount = next.spec.nodePools.reduce(
            (a, p) => a + p.nodeCount * p.gpuPerNode,
            0,
          );
          precheck(next, r.resourceUuid);
          r.spec = next.spec;
        } else fail(422, "VALIDATION_ERROR");
      } else fail(404, "NOT_FOUND");
      if (action === "resize") syncResourceNetwork(db.network, r);
      addEvent(
        r,
        action === "stop" ? "stopped" : action === "start" ? "ready" : action,
        before,
        r.status,
      );
      if (action === "start" || action === "stop") db.events[0].action = action;
      if (r.kind === "vgpu" && (action === "cordon" || action === "uncordon")) {
        Object.assign(db.events[0], {
          type: action === "cordon" ? "NODE_CORDONED" : "NODE_UNCORDONED",
          component: "scheduler",
          reason: String(body.nodeUuid),
          action: action === "cordon" ? "NODE_CORDONED" : "NODE_UNCORDONED",
          before: action === "cordon" ? "ready" : "unschedulable",
          after: action === "cordon" ? "unschedulable" : "ready",
          metric: "scheduler_pending_pods",
          value: clusterView(r).scheduling.reduce(
            (sum, item) => sum + item.count,
            0,
          ),
        });
      }
      if (r.kind === "vgpu" && action === "resize") {
        Object.assign(db.events[0], {
          type: "NODE_POOL_RESIZED",
          component: "node-pool",
          reason: r.spec.nodePools[Number(body.poolIndex)].poolCode,
          action: "NODE_POOL_RESIZED",
          before: String(resizePreviousCount ?? "—"),
          after: String(body.count),
          metric: "gpu_count",
          value: r.spec.gpuCount,
        });
      }
      if (
        r.kind === "inference" &&
        (action === "governance" || action === "traffic")
      )
        Object.assign(db.events[0], {
          type: "GOVERNANCE_UPDATED",
          reason: "推理网关策略与灰度流量已更新",
          action: "核对服务请求错误率与延迟",
          before: governanceBefore,
          after: JSON.stringify(governanceSettings(r)),
          metric: "canary_percent",
          value: r.spec.canaryPercent,
          threshold: 99,
        });
      persist();
      return json(r);
    }
  }
  if (path === "/api/deployment-orders" && method === "POST") {
    if (faultFor(url) === "insufficient") fail(409, "INSUFFICIENT_CAPACITY");
    if (faultFor(url) === "billing") fail(503, "BILLING_UNAVAILABLE");
    if (db.account.creditBalance < 0) fail(409, "INSUFFICIENT_BALANCE");
    const idempotencyKey = request.headers.get("Idempotency-Key") || "";
    const previous = idempotencyKey
      ? db.orders.find((o) => o.idempotencyKey === idempotencyKey)
      : undefined;
    if (previous)
      return json({
        resource: resource(previous.resourceUuid),
        order: previous,
        apiKey: null,
      });
    const parsed = orderSchema.parse(body);
    if (!db.projects.some((p) => p.id === parsed.projectId && !p.deletedAt))
      fail(422, "VALIDATION_ERROR");
    const spec = normalizeSpec(parsed.spec);
    const pool = GPU_SPECS[parsed.nodePool];
    if (
      (parsed.kind === "gpu_vm" || parsed.kind === "gpu_baremetal") &&
      "authMethod" in spec &&
      spec.authMethod === "password"
    )
      z.string().min(8).max(128).parse(body.authPassword);
    if (parsed.kind === "gpu_vm" && "gpuPerInstance" in spec)
      spec.gpuCount = spec.gpuDisabled
        ? 0
        : spec.quantity * spec.gpuPerInstance;
    if (parsed.kind === "gpu_baremetal" && "machineCount" in spec)
      spec.gpuCount = spec.machineCount * pool.gpusPerNode;
    if (parsed.kind === "vgpu" && "nodePools" in spec)
      spec.nodePools = spec.nodePools.map((pool) => ({
        ...pool,
        gpuPerNode: GPU_SPECS[pool.poolCode].gpusPerNode,
      }));
    if (parsed.kind === "vgpu" && "nodePools" in spec)
      spec.gpuCount = spec.nodePools.reduce(
        (a, p) => a + p.nodeCount * GPU_SPECS[p.poolCode].gpusPerNode,
        0,
      );
    if (parsed.kind === "inference" && "replicas" in spec)
      spec.gpuCount = spec.replicas * spec.gpuPerReplica;
    let resourceUuid: ResourceUuid;
    do {
      resourceUuid = crypto.randomUUID() as ResourceUuid;
    } while (
      db.resources.some(
        (r) => r.displayId === displayId(parsed.kind, resourceUuid),
      )
    );
    for (const row of spec.storageSelections || [])
      if (
        row.kind === "object" &&
        db.buckets.some((bucket) => bucket.name === row.name)
      )
        fail(409, "BUCKET_NAME_CONFLICT");
    const r = {
      ...parsed,
      spec,
      resourceUuid,
      displayId: displayId(parsed.kind, resourceUuid),
      createdAt: new Date().toISOString(),
      provisioningSince: new Date().toISOString(),
      allocationSource: "order",
      runningSince: null,
      stoppedAt: null,
      deletedAt: null,
      status: "provisioning",
      orderUuid: crypto.randomUUID(),
    } as Resource;
    precheck(r);
    syncResourceNetwork(db.network, r);
    db.resources.push(r);
    if (
      (r.kind === "gpu_vm" || r.kind === "gpu_baremetal") &&
      r.spec.authMethod === "password"
    ) {
      const password = z.string().min(8).max(128).parse(body.authPassword);
      db.consolePasswordFingerprints[r.resourceUuid] =
        consolePasswordFingerprint(r.resourceUuid, password);
    }
    db.volumes.push(...volumesForResource(r));
    for (const row of spec.storageSelections || []) {
      if (row.kind !== "object") continue;
      db.buckets.push({
        id: crypto.randomUUID(),
        name: row.name,
        region: r.region,
        projectId: r.projectId,
        storageClass: row.tier === "oss_ia" ? "IA" : "STANDARD",
        attachedResourceUuid: r.resourceUuid,
        access: "private",
        quotaGb: row.sizeGb,
        createdAt: r.createdAt,
        objects: [],
        lifecycle: [],
        references: [{ name: r.name, href: resourceLink(r) }],
      });
    }
    const order = {
      idempotencyKey,
      orderUuid: r.orderUuid,
      projectId: r.projectId,
      resourceUuid,
      status: "provisioning",
      requested_spec: structuredClone(spec),
      price_snapshot: estimate(r, RATES),
      sourceType: String(body.sourceType || "direct"),
      sourceRefId: String(body.sourceRefId || ""),
      createdAt: r.createdAt,
    };
    db.orders.push(order);
    if (spec.scaling)
      db.policies.push({
        id: crypto.randomUUID(),
        resourceUuid,
        name: `${r.displayId}-autoscaler`,
        config: spec.scaling,
        status: "active",
        updatedAt: r.createdAt,
      });
    addEvent(r, "provisioning", "requested", "provisioning");
    persist();
    return json(
      {
        resource: r,
        order,
        apiKey:
          r.kind === "inference" && r.spec.authEnabled
            ? `rs_${crypto.randomUUID().replaceAll("-", "")}`
            : null,
      },
      201,
    );
  }
  if (path === "/api/deployment-orders/estimate" && method === "POST") {
    const input = body as unknown as Parameters<typeof estimate>[0];
    const spec = normalizeSpec(input.spec);
    if ("nodePools" in spec) {
      spec.nodePools = spec.nodePools.map((pool) => ({
        ...pool,
        gpuPerNode: GPU_SPECS[pool.poolCode].gpusPerNode,
      }));
      spec.gpuCount = spec.nodePools.reduce(
        (n, p) => n + p.nodeCount * p.gpuPerNode,
        0,
      );
    }
    return json(estimate({ ...input, spec }, RATES));
  }
  if (path.startsWith("/api/metrics/")) {
    const parts = path.split("/");
    const r = resource(parts[4]);
    const fault = faultFor(url);
    if (parts[5] === "hardware") {
      if (r.kind !== "gpu_baremetal") fail(404, "NOT_FOUND");
      const node = z.coerce
        .number()
        .int()
        .min(0)
        .max(r.spec.machineCount - 1)
        .parse(qs.get("node") || 0);
      if (
        fault === "xid48" &&
        !db.events.some(
          (e) => e.resourceUuid === r.resourceUuid && e.type === "XID_48",
        )
      )
        db.events.unshift({
          id: crypto.randomUUID(),
          resourceUuid: r.resourceUuid,
          type: "XID_48",
          at: new Date().toISOString(),
          actor: "hardware-controller",
          component: "GPU",
          reason: "检测到 Xid 48，不可纠正 ECC 双比特错误",
          before: "ecc_dbe=0",
          after: "ecc_dbe=2",
          action: "隔离故障 GPU 并提交硬件工单",
          metric: "ecc_dbe",
          value: 2,
          threshold: 1,
        });
      return json(hardwareSnapshot(r, node, fault));
    }
    if (parts[5] === "cluster") {
      if (r.kind !== "vgpu") fail(404, "NOT_FOUND");
      return json(clusterView(r, fault));
    }
    if (parts[5] === "replicas") {
      if (r.kind !== "inference") fail(404, "NOT_FOUND");
      return json(replicaView(r, fault));
    }
    if (parts[5] === "processes") {
      if (r.kind !== "gpu_vm") fail(404, "NOT_FOUND");
      if (!["running", "error"].includes(r.status) || r.spec.gpuCount === 0)
        return json([]);
      return json(
        Array.from({ length: r.spec.gpuPerInstance }, (_, i) => ({
          pid: 1240 + i * 13,
          command: "python -m ipykernel_launcher",
          gpu: i,
          memoryMiB: Math.round(GPU_SPECS[r.nodePool].memoryGb * 0.72 * 1024),
          user: "ubuntu",
          startedAt: r.runningSince || r.createdAt,
        })),
      );
    }
    const wanted = (qs.get("metrics") || "").split(",").filter(Boolean);
    let nodeIndex: number | undefined;
    if (qs.has("node")) {
      if (r.kind !== "gpu_baremetal") fail(422, "VALIDATION_ERROR");
      nodeIndex = z.coerce
        .number()
        .int()
        .min(0)
        .max(r.spec.machineCount - 1)
        .parse(qs.get("node"));
    }
    return json(
      metricsFor(r, qs.get("window") || "1h", fault, nodeIndex, {
        keys: wanted,
        catalog: qs.get("catalog") === "true",
        latest: qs.get("latest") === "true",
      }),
    );
  }
  if (path === "/api/projects") {
    if (method === "GET")
      return json(
        db.projects
          .filter((p) => !p.deletedAt || qs.get("includeDeleted") === "true")
          .filter(
            (p) => !qs.get("region") || p.defaultRegion === qs.get("region"),
          )
          .map((p) => ({
            ...p,
            resourceCount: live().filter((r) => r.projectId === p.id).length,
          })),
      );
    if (method === "POST") {
      const name = z.string().min(2).max(63).parse(body.name);
      const slug =
        typeof body.slug === "string" && body.slug
          ? z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .parse(body.slug)
          : `project-${crypto.randomUUID().slice(0, 8)}`;
      if (db.projects.some((p) => p.slug === slug))
        fail(422, "VALIDATION_ERROR");
      const p: Project = {
        id: crypto.randomUUID(),
        name,
        slug,
        isDefault: false,
        defaultRegion:
          body.defaultRegion === undefined
            ? "jp"
            : z.enum(REGIONS).parse(body.defaultRegion),
        labels: [],
        createdAt: new Date().toISOString(),
        members: [{ userId: "enzoOvOyu", name: "enzoOvOyu", role }],
      };
      for (const region of REGIONS) {
        checkNetworkQuota(region, "vpc");
        checkNetworkQuota(region, "subnet", 2);
        checkNetworkQuota(region, "security_group", 4);
      }
      db.projects.push(p);
      for (const region of REGIONS)
        ensureScope(db.network, { projectId: p.id, region });
      persist();
      return json(p, 201);
    }
  }
  const pm = path.match(/^\/api\/projects\/([^/]+)(?:\/(summary|members))?$/);
  if (pm) {
    const p = db.projects.find((p) => p.id === pm[1]) || fail(404, "NOT_FOUND");
    if (p.deletedAt && method !== "GET") fail(410, "GONE");
    if (method === "GET") {
      const rs = live().filter((r) => r.projectId === p.id);
      return json({
        ...p,
        projectUuid: p.id,
        resources: Object.fromEntries(
          KINDS.map((kind) => [
            kind,
            {
              running: rs.filter(
                (r) => r.kind === kind && r.status === "running",
              ).length,
              total: rs.filter((r) => r.kind === kind).length,
            },
          ]),
        ),
        gpuTotal: rs.reduce((a, r) => a + quotaUse(r, "gpu"), 0),
        resourceItems: rs,
        monthCost: round(
          db.usage
            .filter(
              (u) =>
                u.projectId === p.id &&
                u.usageHour.startsWith(new Date().toISOString().slice(0, 7)),
            )
            .reduce((a, u) => a + u.amount, 0),
        ),
        quotas: quotas(),
        myRole: role,
        costTrend7d: summary(
          null,
          new Date().toISOString().slice(0, 7),
          null,
          p.id,
        ).trend.slice(-7),
      });
    }
    if (method === "DELETE") {
      if (!canManageOrg(role)) fail(403, "FORBIDDEN");
      if (p.isDefault) fail(409, "DEFAULT_PROJECT");
      const count = live().filter((r) => r.projectId === p.id).length;
      if (count) fail(409, "PROJECT_HAS_RESOURCES", { resourceCount: count });
      if (
        db.network.eips.some((e) => e.projectId === p.id && !e.releasedAt) ||
        db.network.tunnels.some((t) => t.projectId === p.id && !t.deletedAt) ||
        db.network.vpcs.some(
          (v) => v.projectId === p.id && !v.deletedAt && !v.isDefault,
        ) ||
        db.network.groups.some(
          (g) =>
            g.projectId === p.id &&
            !g.deletedAt &&
            !g.id.startsWith(`sg-${p.id}-`) &&
            !g.id.startsWith(`sg-bm-${p.id}-`),
        ) ||
        db.network.subnets.some(
          (s) =>
            s.projectId === p.id &&
            !s.deletedAt &&
            !s.id.startsWith(`vsw-${p.id}-`) &&
            !s.id.startsWith(`vsw-bm-${p.id}-`),
        )
      )
        fail(409, "NETWORK_HAS_DEPENDENCIES");
      for (const list of [
        db.network.vpcs,
        db.network.subnets,
        db.network.groups,
      ])
        for (const item of list.filter((i) => i.projectId === p.id))
          item.deletedAt = new Date().toISOString();
      p.deletedAt = new Date().toISOString();
      return done();
    }
    if (method === "PATCH") {
      if (!canManageOrg(role)) fail(403, "FORBIDDEN");
      if (pm[2] === "members") {
        p.members = z
          .array(
            z.object({
              userId: z.string().min(1),
              name: z.string().min(1),
              role: z.enum(ROLES),
            }),
          )
          .parse(body.members);
      } else {
        if (body.name) p.name = z.string().min(2).max(63).parse(body.name);
        if (body.defaultRegion)
          p.defaultRegion = z.enum(REGIONS).parse(body.defaultRegion);
        if (body.labels) p.labels = z.array(z.string()).parse(body.labels);
      }
      persist();
      return json(p);
    }
  }
  if (path === "/api/images") return json(IMAGES);
  if (path === "/api/models") return json(db.models);
  if (path === "/api/models/memory" && method === "POST") {
    const model =
      db.models.find((m) => m.id === body.modelRef) ||
      fail(422, "VALIDATION_ERROR");
    const precision = String(body.quantization || "bf16");
    if (!model.quantizations.includes(precision))
      fail(422, "UNSUPPORTED_PRECISION");
    return json(modelMemory(model, precision, Number(body.context || 8192)));
  }

  const modelMatch = path.match(/^\/api\/models\/([^/]+)$/);
  if (modelMatch && method === "PATCH") {
    const m =
      db.models.find((m) => m.id === modelMatch[1]) || fail(404, "NOT_FOUND");
    m.favorite = !!body.favorite;
    persist();
    return json(m);
  }
  if (path === "/api/apps")
    return json([
      {
        id: "chat",
        name: "Chat API",
        description: "OpenAI-compatible API · vLLM · Llama 3.1",
        modelRef: "llama8",
        kind: "inference",
      },
      {
        id: "training",
        name: "LoRA Studio",
        description: "PyTorch · JupyterLab · PEFT",
        imageRef: "pytorch-cu130",
        kind: "gpu_vm",
      },
    ]);
  if (path === "/api/workbench/notebooks") {
    if (method === "GET")
      return json(
        db.notebooks.filter((n) => {
          const r = resource(n.resourceUuid);
          return (
            (!region || r.region === region) &&
            (!qs.get("resource_kind") || r.kind === qs.get("resource_kind")) &&
            (!qs.get("status") || n.status === qs.get("status"))
          );
        }),
      );
    if (method === "POST") {
      const r = resource(String(body.resourceUuid));
      if (r.kind === "inference" || r.deletedAt || r.status !== "running")
        fail(409, "INVALID_STATE");
      const ide = z.enum(["jupyter", "vscode"]).parse(body.ide);
      const id = crypto.randomUUID();
      const n = {
        id,
        name: `${r.name} ${ide}`,
        resourceUuid: r.resourceUuid,
        ide,
        imageRef: z.string().min(1).parse(body.imageRef),
        storageGb: z
          .number()
          .min(1)
          .max(r.spec.storageGb)
          .parse(body.storageGb),
        autoShutdownIdleMin: z
          .number()
          .min(0)
          .max(120)
          .parse(body.autoShutdownIdleMin),
        status: "running",
        createdAt: new Date().toISOString(),
        urlPath: `/connections/notebook/${id}`,
      };
      db.notebooks.push(n);
      persist();
      return json(n, 201);
    }
  }
  const nm = path.match(/^\/api\/workbench\/notebooks\/([^/]+)$/);
  if (nm && method === "DELETE") {
    db.notebooks = db.notebooks.filter((n) => n.id !== nm[1]);
    return done();
  }
  if (path === "/api/scaling/policies") {
    if (method === "GET")
      return json(
        db.policies.filter((p) => {
          const r = resource(p.resourceUuid);
          return (
            (!region || r.region === region) &&
            (!qs.get("strategy_model") ||
              p.config.strategy_model === qs.get("strategy_model")) &&
            (!qs.get("resource_id") || p.resourceUuid === qs.get("resource_id"))
          );
        }),
      );
    if (method === "POST") {
      const r = resource(String(body.resourceUuid));
      if (db.policies.some((p) => p.resourceUuid === r.resourceUuid))
        fail(409, "POLICY_EXISTS");
      const config = scalingSchema.parse(body.config);
      precheck(
        { ...r, spec: { ...r.spec, scaling: config } } as Resource,
        r.resourceUuid,
      );
      const p: ScalingPolicy = {
        id: crypto.randomUUID(),
        resourceUuid: r.resourceUuid,
        name: `${r.displayId}-autoscaler`,
        config,
        status: "active",
        updatedAt: new Date().toISOString(),
      };
      db.policies.push(p);
      r.spec.scaling = config;
      persist();
      return json(p, 201);
    }
  }
  const sm = path.match(/^\/api\/scaling\/policies\/([^/]+)$/);
  if (sm) {
    const p = db.policies.find((p) => p.id === sm[1]) || fail(404, "NOT_FOUND");
    const r = resource(p.resourceUuid);
    if (method === "DELETE") {
      if (r.status === "running") fail(409, "POLICY_BOUND_RESOURCE_RUNNING");
      db.policies = db.policies.filter((x) => x.id !== p.id);
      r.spec.scaling = null;
      return done();
    }
    if (method === "PATCH") {
      if (body.config) {
        const config = scalingSchema.parse(body.config);
        precheck(
          { ...r, spec: { ...r.spec, scaling: config } } as Resource,
          r.resourceUuid,
        );
        p.config = config;
        r.spec.scaling = config;
      }
      if (body.status)
        p.status = z.enum(["active", "paused"]).parse(body.status);
      p.updatedAt = new Date().toISOString();
      persist();
      return json(p);
    }
  }
  if (path === "/api/scaling/events")
    return json(
      db.scalingEvents
        .filter(
          (e) =>
            (!qs.get("resource_id") ||
              e.resourceUuid === qs.get("resource_id")) &&
            (!qs.get("direction") || e.direction === qs.get("direction")) &&
            (!region || resource(e.resourceUuid).region === region),
        )
        .sort((a, b) => b.at.localeCompare(a.at)),
    );
  if (path === "/api/billing/report") {
    const billingPeriod =
      qs.get("billing_period") || new Date().toISOString().slice(0, 7);
    const usage = db.usage
      .filter((row) => period(row, billingPeriod))
      .sort((a, b) => b.usageHour.localeCompare(a.usageHour));
    const invoices = invoicesForSelection(billingPeriod);
    const voucherUsed = voucherUsedInPeriod(billingPeriod);
    const grossAmount = round(usage.reduce((sum, row) => sum + row.amount, 0));
    const selectedInvoice = invoices.find(
      (invoice) => invoice.period === billingPeriod,
    );
    return json({
      usage,
      invoices,
      transactions: db.transactions
        .filter((transaction) => transaction.at.startsWith(billingPeriod))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100),
      grossAmount,
      voucherUsed: selectedInvoice?.voucherUsed ?? voucherUsed,
      payable:
        selectedInvoice?.amount ??
        Math.max(0, round(grossAmount - voucherUsed)),
      balance: db.account.creditBalance,
    });
  }
  if (path === "/api/billing/usage") {
    const from = qs.get("from"),
      to = qs.get("to");
    return json(
      db.usage
        .filter(
          (u) =>
            (!region || u.region === region) &&
            (!qs.get("resource_id") ||
              u.resourceUuid === qs.get("resource_id")) &&
            (!qs.get("billing_period") ||
              period(u, qs.get("billing_period")!)) &&
            (!from || u.usageHour >= from) &&
            (!to || u.usageHour <= to),
        )
        .sort((a, b) => b.usageHour.localeCompare(a.usageHour)),
    );
  }
  if (path === "/api/billing/transactions")
    return json(
      db.transactions
        .filter(
          (tx) =>
            (!qs.get("resource_id") ||
              tx.resourceUuid === qs.get("resource_id")) &&
            (!qs.get("billing_period") ||
              tx.at.startsWith(qs.get("billing_period")!)),
        )
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100),
    );
  if (path === "/api/billing/invoices")
    return json(
      invoicesForSelection(
        qs.get("billing_period") || new Date().toISOString().slice(0, 7),
      ),
    );
  if (path === "/api/billing/vouchers")
    return json(
      db.vouchers
        .slice()
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    );
  if (path === "/api/tickets") {
    if (method === "GET") {
      const q = (qs.get("q") || "").trim().toLowerCase();
      const rows = db.tickets
        .map(normalizeTicket)
        .filter((ticket) => {
          const linked = ticket.resourceUuid
            ? db.resources.find(
                (item) => item.resourceUuid === ticket.resourceUuid,
              )
            : undefined;
          const ticketRegion = ticket.region || linked?.region || null;
          return (
            (!region || ticketRegion === region) &&
            (!qs.get("status") || ticket.status === qs.get("status")) &&
            (!qs.get("priority") || ticket.priority === qs.get("priority")) &&
            (!qs.get("category") || ticket.category === qs.get("category")) &&
            (!q ||
              [
                ticket.caseNumber,
                ticket.title,
                ticket.id,
                linked?.name,
                linked?.displayId,
              ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(q)))
          );
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json(
        rows.map((ticket) => ({
          ...ticket,
          category: ticket.category || "technical",
          caseNumber: ticket.caseNumber || ticket.id,
          region:
            ticket.region ||
            (ticket.resourceUuid
              ? db.resources.find(
                  (item) => item.resourceUuid === ticket.resourceUuid,
                )?.region || null
              : null),
          updatedAt: ticket.updatedAt || ticket.createdAt,
          resolvedAt: ticket.resolvedAt || null,
          resolution: ticket.resolution || "",
          context: ticket.context || {},
          events: ticket.events || [],
          messages: ticket.messages.map((message) => ({
            ...message,
            attachments: message.attachments || [],
          })),
        })),
      );
    }
    if (method === "POST") {
      const category = z
        .enum([
          "gpu_vm",
          "gpu_baremetal",
          "kubernetes",
          "inference",
          "image_driver",
          "network_storage",
          "billing",
          "quota_access",
          "technical",
        ])
        .parse(body.category) as TicketCategory;
      const resourceUuid = body.resourceUuid
        ? (z.string().min(1).parse(body.resourceUuid) as ResourceUuid)
        : null;
      const linked = resourceUuid ? resource(resourceUuid) : null;
      const requiredKind: Partial<Record<TicketCategory, Resource["kind"]>> = {
        gpu_vm: "gpu_vm",
        gpu_baremetal: "gpu_baremetal",
        kubernetes: "vgpu",
        inference: "inference",
      };
      if (requiredKind[category] && !linked)
        fail(422, "TICKET_RESOURCE_REQUIRED");
      if (
        linked &&
        requiredKind[category] &&
        linked.kind !== requiredKind[category]
      )
        fail(422, "TICKET_RESOURCE_MISMATCH");
      const requestedRegion = body.region
        ? (z.enum(REGIONS).parse(body.region) as Region)
        : null;
      const title = z.string().trim().min(3).max(120).parse(body.title);
      const description = z
        .string()
        .trim()
        .min(3)
        .max(10000)
        .parse(body.message);
      const priority = z
        .enum(["low", "normal", "high", "urgent"])
        .parse(body.priority);
      const context = z.record(z.string()).parse(body.context || {});
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const attachments = await storeTicketAttachments(id, body.attachments);
      const ticket: Ticket = {
        id,
        caseNumber: formatResourceId("tkt", id),
        title,
        category,
        resourceUuid: linked?.resourceUuid || null,
        region: linked?.region || requestedRegion,
        context,
        status: "open",
        priority,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        resolution: "",
        messages: [
          {
            actor: "enzoOvOyu",
            body: description,
            at: now,
            attachments,
          },
        ],
        events: [
          {
            id: crypto.randomUUID(),
            type: "created",
            actor: "enzoOvOyu",
            at: now,
            status: "open",
            summary: "tickets.eventCreated",
          },
        ],
      };
      db.tickets.push(ticket);
      persist();
      return json(ticket, 201);
    }
  }
  const attachmentMatch = path.match(
    /^\/api\/tickets\/([^/]+)\/attachments\/([^/]+)$/,
  );
  if (attachmentMatch && method === "GET") {
    const ticket =
      db.tickets.find((item) => item.id === attachmentMatch[1]) ||
      fail(404, "NOT_FOUND");
    const attachment =
      ticket.messages
        .flatMap((message) => message.attachments || [])
        .find((item) => item.id === attachmentMatch[2]) ||
      fail(404, "NOT_FOUND");
    const content = await getObject(attachment.key);
    if (!content) fail(404, "NOT_FOUND");
    return json({
      content,
      name: attachment.name,
      contentType: attachment.contentType,
    });
  }
  const tm = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (tm) {
    const ticket = normalizeTicket(
      db.tickets.find((item) => item.id === tm[1]) || fail(404, "NOT_FOUND"),
    );
    if (method === "PATCH") {
      const now = new Date().toISOString();
      if (body.message !== undefined) {
        if (ticket.status === "closed") fail(409, "TICKET_CLOSED");
        const text = z.string().trim().min(3).max(10000).parse(body.message);
        const attachments = await storeTicketAttachments(
          ticket.id,
          body.attachments,
        );
        ticket.messages.push({
          actor: "enzoOvOyu",
          body: text,
          at: now,
          attachments,
        });
        const previousStatus = ticket.status;
        const shouldReopen =
          previousStatus === "resolved" || previousStatus === "pending";
        ticket.events.push({
          id: crypto.randomUUID(),
          type: "reply",
          actor: "enzoOvOyu",
          at: now,
          status: shouldReopen ? "open" : previousStatus,
          summary: "tickets.eventReply",
        });
        if (shouldReopen) {
          ticket.status = "open";
          ticket.resolvedAt = null;
          ticket.resolution = "";
          ticket.events.push({
            id: crypto.randomUUID(),
            type: "status_changed",
            actor: "enzoOvOyu",
            at: now,
            status: "open",
            summary: "tickets.eventReopened",
          });
        }
      } else if (body.attachments !== undefined) {
        fail(422, "TICKET_MESSAGE_REQUIRED");
      }
      if (body.status !== undefined) {
        const status = z
          .enum(["open", "pending", "resolved", "closed"])
          .parse(body.status);
        const transitions: Record<string, string[]> = {
          open: ["pending", "resolved", "closed"],
          pending: ["open", "resolved", "closed"],
          resolved: ["open", "closed"],
          closed: ["open"],
        };
        if (
          status !== ticket.status &&
          !transitions[ticket.status]?.includes(status)
        )
          fail(409, "TICKET_INVALID_TRANSITION");
        if (status === "resolved") {
          ticket.resolution = z
            .string()
            .trim()
            .min(3)
            .max(2000)
            .parse(body.resolution);
          ticket.resolvedAt = now;
        } else if (status === "open") {
          ticket.resolvedAt = null;
          ticket.resolution = "";
        }
        if (status !== ticket.status) {
          ticket.status = status;
          ticket.events.push({
            id: crypto.randomUUID(),
            type: "status_changed",
            actor: "enzoOvOyu",
            at: now,
            status,
            summary: `tickets.eventStatus.${status}`,
          });
        }
      }
      ticket.updatedAt = now;
      persist();
    }
    if (method !== "GET" && method !== "PATCH") fail(405, "METHOD_NOT_ALLOWED");
    return json(ticket);
  }
  if (path === "/api/datasets") {
    if (method === "GET") {
      const q = (qs.get("q") || "").toLowerCase();
      return json(
        db.datasets
          .filter(
            (d) =>
              d.name.toLowerCase().includes(q) &&
              (!qs.get("format") || d.format_tag === qs.get("format")),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((d) => ({ ...d, ref_count: d.references.length })),
      );
    }
    if (method === "POST") {
      const d: Dataset = {
        id: crypto.randomUUID(),
        name: z.string().min(2).parse(body.name),
        latest_version: "v1.0",
        size_gb: z.number().positive().parse(body.size_gb),
        format_tag: z
          .enum(["parquet", "jsonl", "image"])
          .parse(body.format_tag),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
        preview: body.preview
          ? z
              .array(z.record(z.union([z.string(), z.number()])))
              .max(50)
              .parse(body.preview)
          : [],
        references: [],
      };
      d.versions = [
        { version: "v1.0", size_gb: d.size_gb, note: "Initial upload" },
      ];
      db.datasets.push(d);
      persist();
      return json(d, 201);
    }
  }
  const dm = path.match(/^\/api\/datasets\/([^/]+)(?:\/(versions))?$/);
  if (dm) {
    const d = db.datasets.find((d) => d.id === dm[1]) || fail(404, "NOT_FOUND");
    if (method === "GET") return json(dm[2] ? d.versions : d);
    if (method === "DELETE") {
      if (d.references.length)
        fail(409, "DATASET_IN_USE", { references: d.references });
      db.datasets = db.datasets.filter((x) => x.id !== d.id);
      return done();
    }
    if (method === "POST" && dm[2]) {
      const version = z.string().min(1).parse(body.version);
      if (d.versions.some((v) => v.version === version))
        fail(422, "VALIDATION_ERROR");
      const size_gb = z.number().positive().parse(body.size_gb);
      d.versions.unshift({ version, size_gb, note: String(body.note || "") });
      d.latest_version = version;
      d.size_gb = size_gb;
      d.updatedAt = new Date().toISOString();
      persist();
      return json(d);
    }
    if (method === "PATCH") {
      d.name = z.string().min(2).parse(body.name);
      persist();
      return json(d);
    }
  }
  if (path === "/api/buckets") {
    if (method === "GET")
      return json(db.buckets.filter((b) => !region || b.region === region));
    if (method === "POST") {
      const name = z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
        .parse(body.name);
      if (db.buckets.some((b) => b.name === name))
        fail(422, "VALIDATION_ERROR");
      const code = z.enum(REGIONS).parse(body.region);
      const projectId = z.string().min(1).parse(body.projectId);
      if (
        !db.projects.some(
          (project) => project.id === projectId && !project.deletedAt,
        )
      )
        fail(422, "VALIDATION_ERROR");
      const quotaGb = z
        .number()
        .int()
        .min(100)
        .max(1048500)
        .parse(body.quotaGb);
      const allocation = storageQuotaBreakdown(code).find(
        (item) => item.kind === "object",
      );
      if (allocation && allocation.usedGb + quotaGb > allocation.limitGb)
        fail(409, "QUOTA_EXCEEDED", {
          metric: "storage",
          limit: allocation.limitGb,
          used: allocation.usedGb,
          requested: quotaGb,
        });
      const b = {
        id: crypto.randomUUID(),
        name,
        region: code,
        projectId,
        storageClass: z
          .enum(["STANDARD", "IA"])
          .default("STANDARD")
          .parse(body.storageClass),
        attachedResourceUuid: null,
        access: "private" as const,
        quotaGb,
        createdAt: new Date().toISOString(),
        objects: [],
        lifecycle: [],
        references: [],
      };
      db.buckets.push(b);
      persist();
      return json(b, 201);
    }
  }
  const bm = path.match(
    /^\/api\/buckets\/([^/]+)(?:\/(overview|objects|lifecycle|sign))?$/,
  );
  if (bm) {
    const b = db.buckets.find((b) => b.id === bm[1]) || fail(404, "NOT_FOUND");
    const now = Date.now();
    let lifecycleChanged = false;
    for (const rule of b.lifecycle) {
      if (new Date(rule.nextRun).getTime() > now) continue;
      for (const object of [...b.objects]) {
        if (
          !object.key.startsWith(rule.prefix) ||
          new Date(object.updatedAt).getTime() + rule.after_days * 86400000 >
            now
        )
          continue;
        if (rule.action === "delete") {
          await deleteObject(`${b.id}:${object.key}`);
          b.objects = b.objects.filter((item) => item.key !== object.key);
        } else if (object.storageClass !== "IA") {
          object.storageClass = "IA";
        }
        lifecycleChanged = true;
      }
      rule.nextRun = new Date(now + 86400000).toISOString();
      lifecycleChanged = true;
    }
    if (lifecycleChanged) persist();
    const part = bm[2];
    if (method === "DELETE" && !part) {
      if (b.references.length)
        fail(409, "BUCKET_IN_USE", { references: b.references });
      if (b.objects.length)
        fail(423, "HAS_DEPENDENCIES", {
          dependencies: b.objects.map((o) => ({
            name: o.key,
            href: `/storage/object?drawer=${b.id}`,
          })),
        });
      db.buckets = db.buckets.filter((x) => x.id !== b.id);
      return done();
    }
    if (part === "overview")
      return json({
        bucket: b,
        objectCount: b.objects.length,
        usedGb: b.objects.reduce((a, o) => a + o.size, 0) / 1e9,
        quotaGb: b.quotaGb,
        requests: Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() - (6 - i) * 86400000)
            .toISOString()
            .slice(0, 10),
          value: b.objects.length * 120 + (i % 3) * 47,
        })),
      });
    if (part === "objects") {
      if (method === "GET") {
        const prefix = qs.get("prefix") || "";
        const children = b.objects.filter((o) => o.key.startsWith(prefix));
        const prefixes = [
          ...new Set(
            children
              .filter((o) => o.key.slice(prefix.length).includes("/"))
              .map(
                (o) => prefix + o.key.slice(prefix.length).split("/")[0] + "/",
              ),
          ),
        ];
        return json({
          prefixes,
          objects: children.filter(
            (o) => !o.key.slice(prefix.length).includes("/"),
          ),
        });
      }
      if (method === "POST") {
        const key = z.string().min(1).max(1024).parse(body.key);
        const content = String(body.content || "");
        const o: StorageObject = {
          key,
          size: z.number().nonnegative().parse(body.size),
          contentType: String(body.contentType || "application/octet-stream"),
          etag: crypto.randomUUID(),
          storageClass: b.storageClass || "STANDARD",
          updatedAt: new Date().toISOString(),
        };
        if (o.size > 20_000_000) fail(422, "INVALID_FILE");
        const previous = b.objects.find((x) => x.key === key)?.size || 0;
        if (
          b.objects.reduce((a, o) => a + o.size, 0) - previous + o.size >
          b.quotaGb * 1e9
        )
          fail(409, "QUOTA_EXCEEDED");
        try {
          await putObject(`${b.id}:${key}`, content);
        } catch {
          fail(500, "INTERNAL");
        }
        b.objects = b.objects.filter((x) => x.key !== key);
        b.objects.push(o);
        persist();
        return json(o, 201);
      }
      if (method === "DELETE") {
        const key = qs.get("key") || "";
        b.objects = b.objects.filter((o) => o.key !== key);
        await deleteObject(`${b.id}:${key}`);
        return done();
      }
    }
    if (part === "sign") {
      const key = qs.get("key") || "";
      const o = b.objects.find((o) => o.key === key) || fail(404, "NOT_FOUND");
      const expires = z.coerce
        .number()
        .int()
        .min(60)
        .max(604800)
        .parse(qs.get("expires") || 3600);
      const content = await getObject(`${b.id}:${key}`);
      return json({
        url:
          content ||
          `https://s3.${b.region}.runsun.cloud/${b.name}/${encodeURIComponent(o.key)}?expires=${Math.floor(Date.now() / 1000) + expires}&signature=${crypto.randomUUID()}`,
        expires,
      });
    }
    if (part === "lifecycle") {
      if (method === "PUT") {
        const rules = z
          .array(
            z.object({
              prefix: z.string(),
              action: z.enum(["delete", "infrequent"]),
              after_days: z.number().int().min(1).max(3650),
            }),
          )
          .parse(body.rules);
        b.lifecycle = rules.map((rule) => ({
          ...rule,
          nextRun: new Date(Date.now() + 86400000).toISOString(),
        }));
        persist();
      }
      return json(b.lifecycle);
    }
    return json(b);
  }
  if (path === "/api/pipelines") {
    if (method === "GET")
      return json(
        db.pipelines
          .filter((p) => !qs.get("q") || p.name.includes(qs.get("q")!))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    if (method === "POST") {
      const p: Pipeline = {
        ...structuredClone(PIPELINES[0]),
        id: crypto.randomUUID(),
        name: z.string().min(2).parse(body.name),
        createdAt: new Date().toISOString(),
        runs: [],
      };
      db.pipelines.push(p);
      const source = p.nodes.find((n) => n.type === "source");
      if (source) {
        const d = db.datasets.find((d) => d.id === source.parameters.dataset);
        if (d)
          d.references.push({
            id: p.id,
            name: p.name,
            href: `/data/pipelines?drawer=${p.id}`,
          });
      }
      persist();
      return json(p, 201);
    }
  }
  const ppm = path.match(/^\/api\/pipelines\/([^/]+)(?:\/(runs))?$/);
  if (ppm) {
    const p =
      db.pipelines.find((p) => p.id === ppm[1]) || fail(404, "NOT_FOUND");
    if (method === "GET") return json(ppm[2] ? p.runs : p);
    if (method === "DELETE") {
      db.pipelines = db.pipelines.filter((x) => x.id !== p.id);
      for (const d of db.datasets)
        d.references = d.references.filter((ref) => ref.id !== p.id);
      return done();
    }
    if (method === "PATCH") {
      if (body.nodes) {
        const nextNodes = z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              type: z.enum(["source", "process", "train", "output"]),
              inputs: z.array(z.string()),
              parameters: z.record(z.union([z.string(), z.number()])),
            }),
          )
          .parse(body.nodes);
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const ids = new Set(nextNodes.map((n) => n.id));
        if (ids.size !== nextNodes.length) fail(422, "VALIDATION_ERROR");
        const visit = (id: string) => {
          if (visiting.has(id) || !ids.has(id)) fail(422, "VALIDATION_ERROR");
          if (visited.has(id)) return;
          visiting.add(id);
          for (const dep of nextNodes.find((n) => n.id === id)!.inputs)
            visit(dep);
          visiting.delete(id);
          visited.add(id);
        };
        for (const node of nextNodes) visit(node.id);
        p.nodes = nextNodes;
        for (const d of db.datasets)
          d.references = d.references.filter((ref) => ref.id !== p.id);
        for (const n of p.nodes.filter((n) => n.type === "source")) {
          const d = db.datasets.find((d) => d.id === n.parameters.dataset);
          if (!d) fail(422, "VALIDATION_ERROR");
          d.references.push({
            id: p.id,
            name: p.name,
            href: `/data/pipelines?drawer=${p.id}`,
          });
        }
      }
      persist();
      return json(p);
    }
    if (method === "POST" && ppm[2]) {
      const run = {
        id: crypto.randomUUID(),
        status: "running",
        startedAt: new Date().toISOString(),
        durationS: 0,
        actor: "enzoOvOyu",
        nodeLogs: p.nodes.map((n) => ({
          nodeId: n.id,
          level: "info",
          at: new Date().toISOString(),
          message: `${n.name}: scheduled; inputs=${n.inputs.join(",") || "dataset"}`,
        })),
        artifacts: [] as string[],
      };
      p.runs.unshift(run);
      persist();
      return json(run, 201);
    }
  }
  const runm = path.match(/^\/api\/pipeline-runs\/([^/]+)\/nodes$/);
  if (runm) {
    const p =
      db.pipelines.find((p) => p.runs.some((r) => r.id === runm[1])) ||
      fail(404, "NOT_FOUND");
    const run = p.runs.find((r) => r.id === runm[1])!;
    const age = (Date.now() - new Date(run.startedAt).getTime()) / 1000;
    if (run.status === "running" && age > 20) {
      run.status = "success";
      run.durationS = Math.round(age);
      run.artifacts = ["datasets/processed/output.parquet"];
      const bucket = db.buckets.find((b) => b.id === "bucket-jp");
      if (
        bucket &&
        !bucket.objects.some(
          (o) => o.key === "datasets/processed/output.parquet",
        )
      )
        bucket.objects.push({
          key: "datasets/processed/output.parquet",
          size: 128400000,
          contentType: "application/octet-stream",
          etag: run.id,
          storageClass: bucket.storageClass || "STANDARD",
          updatedAt: new Date().toISOString(),
        });
      persist();
    }
    return json({ run, nodes: p.nodes });
  }
  fail(404, "NOT_FOUND");
}
export async function handleMockRequest(
  request: Request,
  options: { delayMs?: number; settleBilling?: boolean } = {},
): Promise<Response> {
  const delayMs =
    options.delayMs ?? (import.meta.env.MODE === "test" ? 0 : 100);
  if (delayMs > 0) await delay(delayMs);
  try {
    return await dispatch(request, options.settleBilling ?? true);
  } catch (error) {
    if (error instanceof Failure || error instanceof NetworkFailure)
      return HttpResponse.json(
        { code: error.code, ...error.details },
        { status: error.status },
      );
    if (error instanceof z.ZodError)
      return HttpResponse.json(
        { code: "VALIDATION_ERROR", issues: error.issues },
        { status: 422 },
      );
    if (import.meta.env.DEV || import.meta.env.MODE === "test")
      console.error(error);
    return HttpResponse.json({ code: "INTERNAL" }, { status: 500 });
  }
}
export const handlers = [
  http.all("*/api/*", ({ request }) => handleMockRequest(request)),
];
