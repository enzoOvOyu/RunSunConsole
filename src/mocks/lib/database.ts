import type { NetworkState } from "../../types/network";
import { makeNetwork } from "./network";
import type {
  Resource,
  Project,
  ResourceEvent,
  Usage,
  Transaction,
  Order,
  ScalingPolicy,
  ScalingEvent,
  Notebook,
  Ticket,
  Dataset,
  Bucket,
  Pipeline,
  Model,
  Voucher,
  Account,
} from "../../types/domain";
import { seedResources, seedTime } from "../fixtures/resources";
import {
  MODELS,
  PROJECTS,
  DATASETS,
  BUCKETS,
  PIPELINES,
  VOUCHERS,
  seedTickets,
  seedNotebooks,
} from "../fixtures/content";
import { RATES } from "../fixtures/pricing";
import { estimate, meteringLines, provisioningSeconds } from "./derive";
import { round } from "../../lib/money";
import { defaultScaling, normalizeSpec } from "../../lib/config";
export interface Database {
  network: NetworkState;
  usageMeters: Record<string, { quantity: number; amount: number }>;
  voucherPending: Record<string, number>;
  replicaRestarts: Record<string, Record<string, number>>;
  billingCursors: Record<string, number>;
  resources: Resource[];
  projects: Project[];
  events: ResourceEvent[];
  usage: Usage[];
  transactions: Transaction[];
  orders: Order[];
  policies: ScalingPolicy[];
  scalingEvents: ScalingEvent[];
  notebooks: Notebook[];
  tickets: Ticket[];
  datasets: Dataset[];
  buckets: Bucket[];
  pipelines: Pipeline[];
  models: Model[];
  vouchers: Voucher[];
  account: Account;
}
export function makeDatabase(): Database {
  const resources = seedResources();
  const network = makeNetwork(resources, structuredClone(PROJECTS));
  for (const r of resources) {
    if (r.status === "running") {
      const since =
        r.mode === "spot"
          ? new Date(new Date(seedTime).setUTCHours(6, 0, 0, 0)).getTime() -
            86400000
          : new Date(r.createdAt).getTime() +
            provisioningSeconds(r, MODELS) * 1000;
      r.runningSince = new Date(since).toISOString();
    }
  }

  const events: ResourceEvent[] = resources.map((r, i) => ({
    id: `event-${i}`,
    resourceUuid: r.resourceUuid,
    type:
      r.status === "error"
        ? "failed"
        : r.status === "stopped"
          ? "stopped"
          : r.status === "provisioning"
            ? "provisioning"
            : "ready",
    at:
      r.status === "running"
        ? new Date(
            new Date(r.createdAt).getTime() +
              provisioningSeconds(r, MODELS) * 1000,
          ).toISOString()
        : r.status === "provisioning"
          ? r.createdAt
          : r.stoppedAt || new Date(seedTime - (i + 1) * 3600000).toISOString(),
    actor: "enzoOvOyu",
    component: r.kind === "inference" ? "model-loader" : "provisioner",
    reason:
      r.status === "provisioning"
        ? "下单已受理，正在分配区域内 GPU 与网络资源"
        : r.status === "error"
          ? "模型加载超出显存预算，建议增加 GPU 并行度"
          : r.status === "stopped"
            ? "用户停止资源，GPU 与 vCPU 配额已释放"
            : "资源供给完成，探活检查通过",
    before: "provisioning",
    after: r.status,
    action: r.status === "error" ? "检查配置后重试供给" : "—",
    metric: "readiness",
    value: r.status === "running" ? 1 : 0,
    threshold: 1,
  }));
  for (const r of resources.filter((r) => r.mode === "spot")) {
    const earliest =
      new Date(r.createdAt).getTime() + provisioningSeconds(r, MODELS) * 1000;
    for (let day = 1; day <= 20; day++) {
      const base = new Date(seedTime);
      base.setUTCDate(base.getUTCDate() - day);
      base.setUTCHours(5, 0, 0, 0);
      const stop = base.getTime();
      if (
        stop < earliest ||
        (r.stoppedAt && stop > new Date(r.stoppedAt).getTime())
      )
        continue;
      for (const [type, at, before, after, reason] of [
        ["stopped", stop, "running", "stopped", "抢占式资源回收，算力暂停计费"],
        [
          "ready",
          stop + 3600000,
          "stopped",
          "running",
          "抢占式资源重新就绪，算力恢复计费",
        ],
      ] as const)
        events.push({
          id: `spot-${r.displayId}-${day}-${type}`,
          resourceUuid: r.resourceUuid,
          type,
          at: new Date(at).toISOString(),
          actor: "spot-controller",
          component: r.kind,
          reason,
          before,
          after,
          action: "检查点已保存，可继续工作负载",
          metric: "gpu_count",
          value: type === "stopped" ? 0 : r.spec.gpuCount,
          threshold: r.spec.gpuCount,
        });
    }
  }
  const usage: Usage[] = [];
  for (const r of resources) {
    if (r.status === "provisioning") continue;
    const e = estimate(r, RATES);
    const ready =
      new Date(r.createdAt).getTime() + provisioningSeconds(r, MODELS) * 1000;
    const begin = Math.floor(ready / 3600000) * 3600000;
    const end = Math.floor(seedTime / 3600000) * 3600000;
    const stopAt = r.stoppedAt ? new Date(r.stoppedAt).getTime() : Infinity;
    for (let h = begin; h < end; h += 3600000) {
      const intervalStart = Math.max(h, ready);
      const intervalEnd = h + 3600000;
      const storageHours = Math.max(0, (intervalEnd - intervalStart) / 3600000);
      const priorDay =
        new Date(h).toISOString().slice(0, 10) <
        new Date(seedTime).toISOString().slice(0, 10);
      const preempted =
        r.mode === "spot" && priorDay && new Date(h).getUTCHours() === 5;
      const runningHours = preempted
        ? 0
        : Math.max(
            0,
            (Math.min(intervalEnd, stopAt) - intervalStart) / 3600000,
          );
      const status =
        runningHours > 0
          ? "running"
          : r.status === "error"
            ? "error"
            : "stopped";
      for (const line of meteringLines(e)) {
        const quantity = round(
          line.quantity *
            (line.key === "storage" ? storageHours : runningHours),
          4,
        );
        usage.push({
          id: `${r.resourceUuid}-${h}-${line.unit}`,
          resourceUuid: r.resourceUuid,
          displayId: r.displayId,
          projectId: r.projectId,
          region: r.region,
          kind: r.kind,
          usageHour: new Date(h).toISOString(),
          unit: line.unit,
          quantity,
          unitPrice: line.unitPrice,
          amount: round(quantity * line.unitPrice, 4),
          status,
        });
      }
    }
  }
  const transactions: Transaction[] = [
    {
      id: "credit-initial",
      resourceUuid: null,
      at: new Date(seedTime - 25 * 86400000).toISOString(),
      type: "credit",
      amount: 3_000_000,
      balanceAfter: 3_000_000,
      referenceId: "enterprise-prepayment",
    },
  ];
  for (const r of resources) {
    const amount = round(
      usage
        .filter((u) => u.resourceUuid === r.resourceUuid)
        .reduce((n, u) => n + u.amount, 0),
      4,
    );
    transactions.push({
      id: `tx-${r.displayId}`,
      resourceUuid: r.resourceUuid,
      at: new Date(seedTime - 3600000).toISOString(),
      type: "charge",
      amount: -amount,
      balanceAfter: 0,
      referenceId: `invoice-${new Date().toISOString().slice(0, 7)}`,
    });
  }
  for (const v of VOUCHERS)
    for (const redemption of v.redemptions)
      transactions.push({
        id: `voucher-${v.id}`,
        resourceUuid: null,
        at: redemption.at,
        type: "voucher",
        amount: redemption.amount,
        balanceAfter: 0,
        referenceId: redemption.referenceId,
      });
  transactions.sort((a, b) => a.at.localeCompare(b.at));
  let balance = 0;
  for (const tx of transactions) {
    balance = round(balance + tx.amount, 4);
    tx.balanceAfter = balance;
  }
  const policies: ScalingPolicy[] = resources
    .filter((r) => r.kind === "vgpu" || r.kind === "inference")
    .map((r, i) => {
      const config = defaultScaling(r.kind);
      const actual =
        r.kind === "vgpu"
          ? r.spec.nodePools.reduce((s, p) => s + p.nodeCount, 0)
          : r.kind === "inference"
            ? r.spec.replicas
            : 1;
      config.min_size = Math.max(1, actual - 1);
      config.max_size = Math.min(64, actual + 2);
      r.spec.scaling = config;
      return {
        id: `policy-${i}`,
        resourceUuid: r.resourceUuid,
        name: `${r.displayId}-autoscaler`,
        config,
        status: "active",
        updatedAt: new Date(seedTime - (i + 1) * 3600000).toISOString(),
      };
    });
  const scalingEvents: ScalingEvent[] = policies.flatMap((p) => [
    {
      id: `scale-${p.id}`,
      resourceUuid: p.resourceUuid,
      policyId: p.id,
      direction: "scale_out",
      from: p.config.min_size,
      to: p.config.min_size + 1,
      metric: p.config.trigger_metric,
      value: 64,
      threshold: 50,
      durationS: p.config.strategy_model === "replica" ? 42 : 164,
      at: p.updatedAt,
    },
  ]);
  const orders: Order[] = resources.map((r) => ({
    orderUuid: r.orderUuid,
    projectId: r.projectId,
    resourceUuid: r.resourceUuid,
    status:
      r.status === "error"
        ? "failed"
        : r.status === "provisioning"
          ? "provisioning"
          : "completed",
    requested_spec: structuredClone(r.spec),
    price_snapshot: estimate(r, RATES),
    sourceType: r.kind === "inference" ? "model" : "image",
    sourceRefId: r.kind === "inference" ? r.spec.modelRef : "pytorch",
    createdAt: r.createdAt,
  }));
  return {
    network,
    usageMeters: {},
    voucherPending: {},
    replicaRestarts: {},
    billingCursors: {},
    resources,
    projects: structuredClone(PROJECTS),
    events,
    usage,
    transactions,
    orders,
    policies,
    scalingEvents,
    notebooks: seedNotebooks(resources),
    tickets: seedTickets(resources),
    datasets: structuredClone(DATASETS),
    buckets: structuredClone(BUCKETS),
    pipelines: structuredClone(PIPELINES),
    models: structuredClone(MODELS),
    vouchers: structuredClone(VOUCHERS),
    account: {
      org: "RunSun Research",
      user: "enzoOvOyu",
      plan: "enterprise",
      depletedAt: null,
      creditBalance: balance,
      lowBalanceThresholdUsd: Number(
        import.meta.env.VITE_LOW_BALANCE_THRESHOLD_USD || 50,
      ),
      budget: 1_200_000,
    },
  };
}
const KEY = "rs.mock.database.v2";
type StoredDatabase = Omit<Database, "usage"> & {
  usage: [string, number | string, number, number, number, number, number][];
};
const unitNames = [
  "per_gpu_hour",
  "per_machine_hour",
  "per_cluster_hour",
  "per_gb_hour",
  "per_ip_hour",
] as const;
const statusNames = [
  "provisioning",
  "running",
  "stopped",
  "error",
  "terminating",
] as const;
export function restoreDatabase() {
  try {
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (stored) {
      const data = JSON.parse(stored) as StoredDatabase;
      const hadNetwork = !!data.network;
      for (const r of data.resources) {
        if ((r.region as string) !== "th") continue;
        if (hadNetwork) {
          if (!r.spec.vpc || r.spec.vpc === "default-vpc")
            r.spec.vpc = `vpc-${r.projectId}-th`;
          if (r.spec.subnet === "th-default" || r.spec.subnet === "th-private")
            r.spec.subnet = `vsw-${r.projectId}-th-${r.spec.subnet === "th-private" ? "b" : "a"}`;
          r.spec.securityGroups = (r.spec.securityGroups || ["default"]).map((id) =>
            ["default", "ssh-only", "web", "restricted"].includes(id)
              ? `sg-${r.projectId}-th-${id}`
              : id,
          );
        } else {
          r.spec.subnet = "jp-default";
        }
        r.region = "jp";
      }
      data.resources = data.resources.map(
        (r) => ({ ...r, spec: normalizeSpec(r.spec) }) as Resource,
      );
      data.network ??= makeNetwork(data.resources, data.projects);
      for (const list of [
        data.network.vpcs,
        data.network.subnets,
        data.network.groups,
        data.network.interfaces,
        data.network.eips,
        data.network.tunnels,
        data.network.audit,
        data.buckets,
      ])
        for (const entity of list)
          if ((entity.region as string) === "th") entity.region = "jp";
      for (const voucher of data.vouchers)
        voucher.regions = [...new Set(voucher.regions.map((r) =>
          (r as string) === "th" ? "jp" : r,
        ))];
      data.usageMeters ??= {};
      data.replicaRestarts ??= {};
      data.voucherPending ??= {};
      if (data.account.plan === "Pro") data.account.plan = "enterprise";
      const usage: Usage[] = data.usage.map(
        ([
          id,
          resourceIndex,
          hour,
          unitIndex,
          quantity,
          unitPrice,
          statusIndex,
        ]) => {
          const r =
            typeof resourceIndex === "number"
              ? data.resources[resourceIndex]
              : data.network.eips.find((e) => e.id === resourceIndex)!;
          return {
            id,
            resourceUuid: "resourceUuid" in r ? r.resourceUuid : r.id,
            displayId: r.displayId,
            projectId: r.projectId,
            region: r.region,
            kind: r.kind,
            usageHour: new Date(hour).toISOString(),
            unit: unitNames[unitIndex],
            quantity,
            unitPrice,
            amount: round(quantity * unitPrice, 4),
            status: statusNames[statusIndex],
          };
        },
      );
      return {
        ...data,
        billingCursors: data.billingCursors || {},
        replicaRestarts: data.replicaRestarts || {},
        voucherPending: data.voucherPending || {},
        usage,
      };
    }
  } catch {
    /* Seed data remains available when stored content cannot be restored. */
  }
  return makeDatabase();
}
export const db = restoreDatabase();
export function persist() {
  if (typeof localStorage === "undefined") return;
  const indexes = new Map(db.resources.map((r, i) => [r.resourceUuid, i]));
  const stored: StoredDatabase = {
    ...db,
    transactions: db.transactions.slice(-3000),
    usage: db.usage.map((u) => [
      u.id,
      indexes.get(u.resourceUuid) ?? u.resourceUuid,
      new Date(u.usageHour).getTime(),
      unitNames.indexOf(u.unit),
      u.quantity,
      u.unitPrice,
      statusNames.indexOf(u.status),
    ]),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    throw new Error("PERSISTENCE_FAILED");
  }
}
export function addEvent(
  r: Resource,
  type: string,
  before: string,
  after: string,
) {
  db.events.unshift({
    id: crypto.randomUUID(),
    resourceUuid: r.resourceUuid,
    type,
    at: new Date().toISOString(),
    actor: "enzoOvOyu",
    component: r.kind,
    reason:
      type === "provisioning"
        ? "下单已受理，正在分配区域内 GPU 与网络资源"
        : type === "deleted"
          ? "资源释放，按实际秒数结算最后一小时"
          : type === "stopped"
            ? "用户停止资源，GPU 与 vCPU 配额已释放"
            : type === "failed"
              ? "模型加载超出显存预算，建议增加 GPU 并行度"
              : "资源供给完成，探活检查通过",
    before,
    after,
    action: "—",
    metric: "gpu_count",
    value: r.spec.gpuCount,
    threshold: r.spec.gpuCount,
  });
}
