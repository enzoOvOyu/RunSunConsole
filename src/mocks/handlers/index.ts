import { hardwareSnapshot, clusterView, replicaView } from "../lib/runtime";
import { seedResources } from "../fixtures/resources";
import { http, HttpResponse, delay } from "msw";
import {
  KINDS,
  REGIONS,
  ROLES,
  type Region,
  type Resource,
  type ResourceUuid,
  type Role,
  type Quota,
  type Usage,
  type ScalingPolicy,
  type StorageObject,
  type Pipeline,
  type Dataset,
  type Project,
} from "../../types/domain";
import { db, persist, addEvent } from "../lib/database";
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
import { orderSchema, scalingSchema, isCidr } from "../../lib/schema";
import { canWrite, canManageOrg } from "../../lib/rbac";
import { displayId } from "../../lib/ids";
import { round } from "../../lib/money";
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
const used = (region: Region, metric: Quota["metric"], exclude?: string) =>
  live()
    .filter((r) => r.region === region && r.resourceUuid !== exclude)
    .reduce((a, r) => a + quotaUse(r, metric), 0);
const limits: Record<Region, Record<Quota["metric"], number>> = {
  jp: { gpu: 400, vcpu: 6400, storage: 20480, ip: 16 },
  th: { gpu: 128, vcpu: 2048, storage: 10240, ip: 8 },
  sg: { gpu: 320, vcpu: 5120, storage: 16384, ip: 12 },
  us: { gpu: 640, vcpu: 10240, storage: 32768, ip: 32 },
};
export const quotas = (): Quota[] =>
  REGIONS.flatMap((region) =>
    (["gpu", "vcpu", "storage", "ip"] as const).map((metric) => ({
      region,
      metric,
      limitValue: limits[region][metric],
      usedValue: used(region, metric),
    })),
  );
const period = (u: Usage, p: string) => u.usageHour.startsWith(p);
const initialAllocations = seedResources();
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
  for (const metric of ["gpu", "vcpu", "storage", "ip"] as const) {
    const amount =
      quotaUse({ ...r, status: "running" } as Resource, metric) *
      (metric === "gpu" || metric === "vcpu" ? multiplier : 1);
    if (used(r.region, metric, exclude) + amount > limits[r.region][metric])
      fail(409, "QUOTA_EXCEEDED", {
        metric,
        limit: limits[r.region][metric],
        used: used(r.region, metric, exclude),
        requested: amount,
      });
  }
  if (r.kind === "inference") {
    const model =
      db.models.find((m) => m.id === r.spec.modelRef) ||
      fail(422, "VALIDATION_ERROR");
    if (
      !model.quantizations.includes(r.spec.quantization) ||
      r.spec.maxModelLen > model.context
    )
      fail(422, "VALIDATION_ERROR");
    if (
      modelMemory(model, r.spec.quantization, r.spec.maxModelLen).requiredGb >
      pool.memoryGb * r.spec.gpuPerReplica
    )
      fail(422, "MODEL_MEMORY_EXCEEDED");
  }
  if (r.kind === "gpu_vm" || r.kind === "gpu_baremetal") {
    if (!r.spec.subnet.startsWith(r.region + "-"))
      fail(422, "VALIDATION_ERROR");
    const image = IMAGES.find((i) => i.id === r.spec.imageRef);
    if (
      !image ||
      (r.kind === "gpu_baremetal" && image.type !== "os") ||
      (r.kind === "gpu_vm" && image.sizeGb > r.spec.systemDiskGb)
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
    for (const line of meteringLines(e)) {
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
function tick() {
  if (db.account.creditBalance >= 0) db.account.depletedAt = null;
  else db.account.depletedAt ??= new Date().toISOString();

  for (const r of live()) {
    settle(r);
    if (db.account.depletedAt) {
      const start = new Date(db.account.depletedAt).getTime();
      const age = Date.now() - start;
      if (age >= 86400000 && r.status === "running") {
        r.status = "stopped";
        r.runningSince = null;
        r.stoppedAt = new Date(start + 86400000).toISOString();
        addEvent(r, "stopped", "running", "stopped");
        settle(r);
      }
      if (age >= 8 * 86400000) {
        r.deletedAt = new Date(start + 8 * 86400000).toISOString();
        r.status = "terminating";
        r.runningSince = null;
        addEvent(r, "deleted", "stopped", "terminating");
        continue;
      }
    }
    if (r.status === "provisioning") {
      const age =
        (Date.now() - new Date(r.provisioningSince || r.createdAt).getTime()) /
        1000;
      const duration = provisioningSeconds(r, db.models);
      if (age > duration) {
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
      }
    }
  }
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
  const month = round(usage.reduce((a, u) => a + u.amount, 0));
  const today = round(
    usage
      .filter((u) =>
        u.usageHour.startsWith(new Date().toISOString().slice(0, 10)),
      )
      .reduce((a, u) => a + u.amount, 0),
  );
  const hourly = rs.reduce((a, r) => a + costPerHour(r, RATES), 0);
  const dates = Array.from({ length: 30 }, (_, i) =>
    new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
  );
  const trend = dates.map((day) => ({
    date: day,
    amount: round(
      usage
        .filter((u) => u.usageHour.startsWith(day))
        .reduce((a, u) => a + u.amount, 0),
    ),
    ...Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        round(
          usage
            .filter((u) => u.usageHour.startsWith(day) && u.kind === kind)
            .reduce((a, u) => a + u.amount, 0),
        ),
      ]),
    ),
    ...Object.fromEntries(
      db.projects.map((project) => [
        project.id,
        round(
          usage
            .filter(
              (u) => u.usageHour.startsWith(day) && u.projectId === project.id,
            )
            .reduce((n, u) => n + u.amount, 0),
        ),
      ]),
    ),
  }));
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
    estimate: resourceId ? estimate(resource(resourceId), RATES) : null,
    remainingHours: hourly > 0 ? db.account.creditBalance / hourly : null,
    running: rs.filter((r) => r.status === "running").length,
    allocated: rs.reduce((a, r) => a + r.spec.gpuCount, 0),
    balance: db.account.creditBalance,
    budget: db.account.budget,
    voucherUsed: db.vouchers
      .flatMap((v) => v.redemptions)
      .filter((v) => v.at.startsWith(billingPeriod))
      .reduce((a, v) => a + v.amount, 0),
    trend,
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
    privateIp: `10.${REGIONS.indexOf(r.region) + 10}.0.${(parseInt(r.resourceUuid.slice(-4), 16) % 250) + 2}`,
    placement: {
      rackId: `${r.region.toUpperCase()}-R${(parseInt(r.resourceUuid.slice(-2), 16) % 8) + 1}`,
      switchGroup: `${r.region.toUpperCase()}-IB-A`,
      nodes: Array.from({ length: nodeCount }, (_, i) => ({
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
async function dispatch(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const qs = url.searchParams;
  const role = (request.headers.get("X-Role") || "owner") as Role;
  if (!ROLES.includes(role)) fail(403, "FORBIDDEN");
  if (method !== "GET" && !canWrite(role)) fail(403, "FORBIDDEN");
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
  tick();
  if (path === "/api/deployment-options") {
    const code = (region || "jp") as Region;
    return json({
      vpcs: [
        {
          id: "default-vpc",
          name: "默认私有网络",
          subnets: [
            { id: `${code}-default`, name: "默认子网", region: code },
            { id: `${code}-private`, name: "私有子网", region: code },
          ],
        },
      ],
      securityGroups: [
        { id: "default", name: "默认安全组" },
        { id: "ssh-only", name: "仅 SSH" },
        { id: "web", name: "Web 访问" },
        { id: "restricted", name: "受限访问" },
      ],
      k8sVersions: ["1.28", "1.29", "1.30", "1.31"],
    });
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
      regions: REGIONS.map((region) => ({
        region,
        count: rs.filter((r) => r.region === region).length,
        gpu: rs
          .filter((r) => r.region === region)
          .reduce((a, r) => a + r.spec.gpuCount, 0),
      })),
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
    if (
      summary(null, new Date().toISOString().slice(0, 7)).month >
      db.account.budget
    )
      items.push({
        id: "budget",
        messageKey: "billing.overBudget",
        href: role === "member" ? "/ops/tickets?new=budget" : "/ops/cost",
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
          privateIp: `10.${REGIONS.indexOf(r.region) + 10}.0.${(parseInt(r.resourceUuid.slice(-4), 16) % 250) + 2}`,
          publicIp: null,
          ssh: `ssh ubuntu@10.${REGIONS.indexOf(r.region) + 10}.0.${(parseInt(r.resourceUuid.slice(-4), 16) % 250) + 2}`,
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
            status: r.deletedAt
              ? "skipped"
              : i / names.length < progress
                ? "success"
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
      r.deletedAt = new Date().toISOString();
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
        return json({ credential: crypto.randomUUID() });
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
      } else if (action === "upgrade") {
        if (r.kind !== "vgpu") fail(422, "VALIDATION_ERROR");
        r.spec.k8sVersion = z
          .enum(["1.28", "1.29", "1.30", "1.31"])
          .parse(body.version);
      } else if (action === "cordon" || action === "drain") {
        if (r.kind !== "vgpu") fail(422, "VALIDATION_ERROR");
        r.labels = [
          ...r.labels.filter((l) => !l.startsWith("node:")),
          `node:${action}`,
        ];
      } else if (action === "traffic") {
        if (r.kind !== "inference") fail(422, "VALIDATION_ERROR");
        r.spec.canaryPercent = z.number().min(0).max(99).parse(body.percent);
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
        const count = z.number().int().min(1).max(32).parse(body.count);
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
          next.spec.nodePools[0].nodeCount = count;
          next.spec.gpuCount = next.spec.nodePools.reduce(
            (a, p) => a + p.nodeCount * p.gpuPerNode,
            0,
          );
          precheck(next, r.resourceUuid);
          r.spec = next.spec;
        } else fail(422, "VALIDATION_ERROR");
      } else fail(404, "NOT_FOUND");
      addEvent(r, action === "stop" ? "stopped" : action, before, r.status);
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
      parsed.kind === "gpu_vm" &&
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
    db.resources.push(r);
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
    const series = metricsFor(r, qs.get("window") || "1h", fault);
    return json(
      wanted.length ? series.filter((s) => wanted.includes(s.key)) : series,
    );
  }
  if (path === "/api/projects") {
    if (method === "GET")
      return json(
        db.projects
          .filter((p) => !p.deletedAt || qs.get("includeDeleted") === "true")
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
        defaultRegion: "jp",
        labels: [],
        createdAt: new Date().toISOString(),
        members: [{ userId: "enzoOvOyu", name: "enzoOvOyu", role }],
      };
      db.projects.push(p);
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
        gpuTotal: rs.reduce((a, r) => a + r.spec.gpuCount, 0),
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
    return json(
      modelMemory(
        model,
        String(body.quantization || "bf16"),
        Number(body.context || 8192),
      ),
    );
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
        imageRef: "pytorch",
        kind: "gpu_vm",
      },
      {
        id: "vision",
        name: "Image Generation",
        description: "FLUX.1 · ComfyUI",
        modelRef: "flux",
        kind: "inference",
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
  if (path === "/api/billing/invoices") {
    const periods = [...new Set(db.usage.map((u) => u.usageHour.slice(0, 7)))];
    return json(
      periods.map((p) => ({
        id: `invoice-${p}`,
        period: p,
        status: p === new Date().toISOString().slice(0, 7) ? "open" : "paid",
        amount: round(
          db.usage
            .filter((u) => period(u, p))
            .reduce((a, u) => a + u.amount, 0),
        ),
      })),
    );
  }
  if (path === "/api/billing/vouchers")
    return json(
      db.vouchers
        .slice()
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    );
  if (path === "/api/tickets") {
    if (method === "GET")
      return json(
        db.tickets.filter(
          (t) =>
            (!region || resource(t.resourceUuid).region === region) &&
            (!qs.get("status") || t.status === qs.get("status")),
        ),
      );
    if (method === "POST") {
      const r = resource(String(body.resourceUuid));
      const t = {
        id: crypto.randomUUID(),
        title: z.string().min(3).max(120).parse(body.title),
        resourceUuid: r.resourceUuid,
        status: "open",
        priority: z.enum(["normal", "high"]).parse(body.priority),
        createdAt: new Date().toISOString(),
        messages: [
          {
            actor: "enzoOvOyu",
            body: z.string().min(3).parse(body.message),
            at: new Date().toISOString(),
          },
        ],
      };
      db.tickets.push(t);
      persist();
      return json(t, 201);
    }
  }
  const tm = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (tm) {
    const ticket =
      db.tickets.find((t) => t.id === tm[1]) || fail(404, "NOT_FOUND");
    if (method === "PATCH") {
      if (body.message)
        ticket.messages.push({
          actor: "enzoOvOyu",
          body: z.string().min(1).parse(body.message),
          at: new Date().toISOString(),
        });
      if (body.status)
        ticket.status = z.enum(["open", "closed"]).parse(body.status);
      persist();
    }
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
      const b = {
        id: crypto.randomUUID(),
        name,
        region: z.enum(REGIONS).parse(body.region),
        access: "private" as const,
        quotaGb: 2048,
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
    const part = bm[2];
    if (method === "DELETE" && !part) {
      if (b.references.length)
        fail(409, "BUCKET_IN_USE", { references: b.references });
      if (b.objects.length)
        fail(423, "HAS_DEPENDENCIES", {
          dependencies: b.objects.map((o) => ({
            name: o.key,
            href: `/data/storage?drawer=${b.id}`,
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
          storageClass: "STANDARD",
          updatedAt: new Date().toISOString(),
        };
        if (o.size > 20_000_000) fail(422, "INVALID_FILE");
        if (
          b.objects.reduce((a, o) => a + o.size, 0) + o.size >
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
          storageClass: "STANDARD",
          updatedAt: new Date().toISOString(),
        });
      persist();
    }
    return json({ run, nodes: p.nodes });
  }
  fail(404, "NOT_FOUND");
}
export const handlers = [
  http.all("*/api/*", async ({ request }) => {
    await delay(import.meta.env.MODE === "test" ? 0 : 100);
    try {
      return await dispatch(request);
    } catch (error) {
      if (error instanceof Failure)
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
  }),
];
