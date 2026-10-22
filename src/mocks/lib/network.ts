import type {
  Resource,
  Project,
  ResourceUuid,
} from "../../types/domain";
import { REGIONS } from "../../types/domain";
import type {
  NetworkState,
  NetworkScope,
  NetworkInterface,
  Subnet,
  ElasticIp,
  SecurityRule,
} from "../../types/network";
import { formatResourceId } from "../../lib/ids";
import {
  cidrRange,
  ipv4String,
  subnetCapacity,
  privateCidr,
  cidrContains,
  cidrOverlaps,
  vpcNetworkType,
} from "../../lib/network";
export class NetworkFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
export function networkFail(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): never {
  throw new NetworkFailure(status, code, details);
}
export function networkAudit(
  n: NetworkState,
  scope: NetworkScope,
  entityId: string,
  action: string,
) {
  n.audit.unshift({
    ...scope,
    id: crypto.randomUUID(),
    entityId,
    action,
    actor: "enzoOvOyu",
    at: new Date().toISOString(),
  });
  n.audit = n.audit.slice(0, 1000);
}
export function ensureScope(n: NetworkState, scope: NetworkScope) {
  const regionIndex = REGIONS.indexOf(scope.region);
  const now = new Date().toISOString();
  for (const vpc of n.vpcs)
    if (!vpc.networkType) vpc.networkType = vpcNetworkType(vpc);
  for (const networkType of ["standard", "baremetal"] as const) {
    const vpcId =
      networkType === "standard"
        ? `vpc-${scope.projectId}-${scope.region}`
        : `vpc-bm-${scope.projectId}-${scope.region}`;
    if (n.vpcs.some((v) => v.id === vpcId)) continue;
    const octet = 16 + regionIndex * 16;
    const bmOctet = 16 + regionIndex * 4;
    const cidr =
      networkType === "standard"
        ? `10.${octet}.0.0/16`
        : `172.${bmOctet}.0.0/16`;
    n.vpcs.push({
      ...scope,
      id: vpcId,
      name: networkType === "standard" ? "default-vpc" : "baremetal-vpc",
      cidr,
      isDefault: true,
      networkType,
      createdAt: now,
    });
    for (const [suffix, block] of [
      ["a", 0],
      ["b", 16],
    ] as const)
      n.subnets.push({
        ...scope,
        id:
          networkType === "standard"
            ? `vsw-${scope.projectId}-${scope.region}-${suffix}`
            : `vsw-bm-${scope.projectId}-${scope.region}-${suffix}`,
        vpcId,
        name: `default-${suffix}`,
        cidr:
          networkType === "standard"
            ? `10.${octet}.${block}.0/20`
            : `172.${bmOctet}.${block}.0/20`,
        zone: `${scope.region}-${suffix}`,
        createdAt: now,
      });
    for (const name of ["default", "ssh-only", "web", "restricted"]) {
      const rules: SecurityRule[] = [];
      if (name === "ssh-only" || name === "default")
        rules.push({
          id: crypto.randomUUID(),
          direction: "inbound",
          action: "allow",
          protocol: "tcp",
          cidr,
          portFrom: 22,
          portTo: 22,
          priority: 1,
          description: "SSH",
        });
      if (name === "web")
        for (const port of [80, 443])
          rules.push({
            id: crypto.randomUUID(),
            direction: "inbound",
            action: "allow",
            protocol: "tcp",
            cidr: "0.0.0.0/0",
            portFrom: port,
            portTo: port,
            priority: 1,
            description: "HTTPS / HTTP",
          });
      n.groups.push({
        ...scope,
        id:
          networkType === "standard"
            ? `sg-${scope.projectId}-${scope.region}-${name}`
            : `sg-bm-${scope.projectId}-${scope.region}-${name}`,
        vpcId,
        name,
        description: "",
        intraGroupPolicy: name === "restricted" ? "deny" : "allow",
        isDefault: name === "default",
        rules,
        createdAt: now,
      });
    }
  }
}
export function interfaceCount(r: Resource) {
  return r.kind === "gpu_vm"
    ? r.spec.quantity
    : r.kind === "gpu_baremetal"
      ? r.spec.machineCount
      : r.kind === "vgpu"
        ? r.spec.nodePools.reduce((n, p) => n + p.nodeCount, 0) +
          (r.spec.controlPlaneTier === "ha" ? 3 : 1)
        : r.spec.replicas;
}
export function subnetUsed(
  n: NetworkState,
  id: string,
  excludeResource?: string,
) {
  return (
    n.interfaces.filter(
      (i) =>
        i.subnetId === id &&
        !i.releasedAt &&
        i.resourceUuid !== excludeResource,
    ).length + n.tunnels.filter((t) => t.subnetId === id && !t.deletedAt).length
  );
}
export function availableIps(
  n: NetworkState,
  id: string,
  excludeResource?: string,
) {
  const subnet = n.subnets.find((s) => s.id === id);
  return subnet
    ? subnetCapacity(subnet.cidr) - subnetUsed(n, id, excludeResource)
    : 0;
}
export function resolveNetwork(n: NetworkState, r: Resource) {
  const requiredType = r.kind === "gpu_baremetal" ? "baremetal" : "standard";
  const defaultId =
    requiredType === "baremetal"
      ? `vpc-bm-${r.projectId}-${r.region}`
      : `vpc-${r.projectId}-${r.region}`;
  const vpcId =
    !r.spec.vpc || r.spec.vpc === "default-vpc" ? defaultId : r.spec.vpc;
  const vpc = n.vpcs.find((v) => v.id === vpcId && !v.deletedAt);
  if (
    !vpc ||
    vpc.projectId !== r.projectId ||
    vpc.region !== r.region ||
    vpcNetworkType(vpc) !== requiredType
  )
    networkFail(409, "NETWORK_SCOPE_MISMATCH");
  const alias = r.spec.subnet?.match(/^(jp|sg|us)-(default|private)$/);
  if (alias && alias[1] !== r.region)
    networkFail(409, "NETWORK_SCOPE_MISMATCH");
  const suffix = alias?.[2] === "private" ? "b" : "a";
  const subnetId =
    !r.spec.subnet || alias
      ? requiredType === "baremetal"
        ? `vsw-bm-${r.projectId}-${r.region}-${suffix}`
        : `vsw-${r.projectId}-${r.region}-${suffix}`
      : r.spec.subnet;
  const subnet = n.subnets.find((s) => s.id === subnetId && !s.deletedAt);
  if (
    !subnet ||
    subnet.vpcId !== vpc.id ||
    subnet.projectId !== r.projectId ||
    subnet.region !== r.region
  )
    networkFail(409, "NETWORK_SCOPE_MISMATCH");
  const names = r.spec.securityGroups ?? ["default"];
  if (!names.length || names.length > 5 || new Set(names).size !== names.length)
    networkFail(422, "VALIDATION_ERROR");
  const groups = names.map(
    (id) =>
      n.groups.find((g) => g.id === id && !g.deletedAt) ||
      (["default", "ssh-only", "web", "restricted"].includes(id)
        ? n.groups.find(
            (g) =>
              g.id ===
                `${requiredType === "baremetal" ? "sg-bm-" : "sg-"}${r.projectId}-${r.region}-${id}` &&
              !g.deletedAt,
          )
        : undefined),
  );
  if (
    !groups.length ||
    groups.some(
      (g) =>
        !g ||
        g.vpcId !== vpc.id ||
        g.projectId !== r.projectId ||
        g.region !== r.region,
    )
  )
    networkFail(409, "NETWORK_SCOPE_MISMATCH");
  return {
    vpc,
    subnet,
    groups: groups.filter((g): g is NonNullable<typeof g> => !!g),
  };
}
export function clusterSubnets(n: NetworkState, r: Extract<Resource, { kind: "vgpu" }>) {
  const { vpc, subnet } = resolveNetwork(n, r);
  const ids = r.spec.subnets?.length ? r.spec.subnets : [subnet.id];
  if (new Set(ids).size !== ids.length || !ids.includes(subnet.id))
    networkFail(422, "INVALID_CLUSTER_SUBNETS");
  const selected = ids.map((id) => n.subnets.find((item) => item.id === id && !item.deletedAt));
  if (selected.some((item) => !item || item.vpcId !== vpc.id || item.projectId !== r.projectId || item.region !== r.region))
    networkFail(409, "NETWORK_SCOPE_MISMATCH");
  const allVpcSubnets = n.subnets.filter((item) => item.vpcId === vpc.id && !item.deletedAt);
  if (allVpcSubnets.some((item) => !verifySubnet(vpc.cidr, item.cidr)) ||
    allVpcSubnets.some((item, index) => allVpcSubnets.slice(index + 1).some((other) => cidrOverlaps(item.cidr, other.cidr))))
    networkFail(422, "INVALID_CLUSTER_SUBNETS");
  const subnets = selected as Subnet[];
  if (subnets.some((item) => !cidrContains(vpc.cidr, item.cidr) || !verifySubnet(vpc.cidr, item.cidr)) ||
    subnets.some((item, index) => subnets.slice(index + 1).some((other) => cidrOverlaps(item.cidr, other.cidr))))
    networkFail(422, "INVALID_CLUSTER_SUBNETS");
  if (r.spec.controlPlaneTier === "ha" && !!r.spec.subnets?.length && new Set(subnets.map((item) => item.zone)).size < 2)
    networkFail(422, "INVALID_CLUSTER_SUBNETS");
  return subnets;
}
export function checkResourceNetwork(n: NetworkState, r: Resource, peak = 1) {
  const { subnet } = resolveNetwork(n, r);
  const controlPlane =
    r.kind === "vgpu" ? (r.spec.controlPlaneTier === "ha" ? 3 : 1) : 0;
  const needed =
    Math.ceil((interfaceCount(r) - controlPlane) * peak) + controlPlane;
  if (r.kind === "vgpu") {
    const subnets = clusterSubnets(n, r);
    const counts = new Map<string, number>();
    for (let index = 0; index < needed; index++) {
      const id = subnets[index % subnets.length].id;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const [id, count] of counts)
      if (availableIps(n, id, r.resourceUuid) < count)
        networkFail(409, "SUBNET_EXHAUSTED", { requested: count, available: availableIps(n, id, r.resourceUuid) });
  } else if (availableIps(n, subnet.id, r.resourceUuid) < needed)
    networkFail(409, "SUBNET_EXHAUSTED", {
      requested: needed,
      available: availableIps(n, subnet.id, r.resourceUuid),
    });
  if (r.spec.eipId) {
    const e = n.eips.find((e) => e.id === r.spec.eipId && !e.releasedAt);
    if (
      !r.spec.publicIp ||
      r.kind !== "gpu_vm" ||
      r.spec.quantity !== 1 ||
      peak > 1 ||
      !e ||
      e.interfaceId ||
      e.tunnelId ||
      e.projectId !== r.projectId ||
      e.region !== r.region
    )
      networkFail(409, "EIP_NOT_AVAILABLE");
  }
  if (r.spec.publicIp && r.kind !== "gpu_vm")
    networkFail(422, "VALIDATION_ERROR");
}
export function nextPrivateIp(n: NetworkState, id: string) {
  const subnet =
    n.subnets.find((s) => s.id === id) || networkFail(404, "NOT_FOUND");
  const range = cidrRange(subnet.cidr)!;
  const used = new Set([
    ...n.interfaces
      .filter((i) => i.subnetId === id && !i.releasedAt)
      .map((i) => i.privateIp),
    ...n.tunnels
      .filter((t) => t.subnetId === id && !t.deletedAt)
      .map((t) => t.privateIp),
  ]);
  for (let offset = 4; offset <= range.size - 2; offset++) {
    const ip = ipv4String(range.start + offset);
    if (!used.has(ip)) return ip;
  }
  return networkFail(409, "SUBNET_EXHAUSTED");
}
export function allocateEip(
  n: NetworkState,
  scope: NetworkScope,
  name: string,
  bandwidthMbps: number,
): ElasticIp {
  const serial = n.ipSerial;
  if (serial >= 500) networkFail(409, "EIP_POOL_EXHAUSTED");
  n.ipSerial++;
  const id = crypto.randomUUID() as ResourceUuid;
  const e: ElasticIp = {
    ...scope,
    id,
    kind: "eip",
    displayId: formatResourceId("eip", id),
    name,
    address: `${serial < 250 ? "198.51.100" : "203.0.113"}.${(serial % 250) + 1}`,
    bandwidthMbps,
    interfaceId: null,
    tunnelId: null,
    createdAt: new Date().toISOString(),
    releasedAt: null,
  };
  n.eips.push(e);
  networkAudit(n, scope, e.id, "eipAllocate");
  return e;
}
export function syncResourceNetwork(
  n: NetworkState,
  r: Resource,
  allocatePublic = true,
) {
  const { vpc, subnet, groups } = resolveNetwork(n, r);
  r.spec.vpc = vpc.id;
  r.spec.subnet = subnet.id;
  r.spec.securityGroups = groups.map((g) => g.id);
  const count = interfaceCount(r);
  const clusterNetwork = r.kind === "vgpu" ? clusterSubnets(n, r) : null;
  const existing = n.interfaces.filter(
    (i) => i.resourceUuid === r.resourceUuid && !i.releasedAt,
  );
  for (const i of existing.filter((i) => i.index >= count))
    releaseInterface(n, i);
  for (let index = 0; index < count; index++) {
    let nic = existing.find((i) => i.index === index);
    const newlyAllocated = !nic;
    if (!nic) {
      const targetSubnet = clusterNetwork ? clusterNetwork[index % clusterNetwork.length] : subnet;
      nic = {
        id: `${r.resourceUuid}-eni-${index}-${n.interfaces.filter((i) => i.resourceUuid === r.resourceUuid && i.index === index).length}`,
        resourceUuid: r.resourceUuid,
        index,
        name: `${r.displayId}-${index + 1}`,
        kind: r.kind,
        projectId: r.projectId,
        region: r.region,
        vpcId: vpc.id,
        subnetId: targetSubnet.id,
        privateIp: nextPrivateIp(n, targetSubnet.id),
        securityGroupIds: groups.map((g) => g.id),
        releasedAt: null,
      };
      n.interfaces.push(nic);
    }
    nic.securityGroupIds = groups.map((g) => g.id);
    if (
      allocatePublic &&
      newlyAllocated &&
      r.kind === "gpu_vm" &&
      r.spec.publicIp &&
      !n.eips.some((e) => e.interfaceId === nic!.id && !e.releasedAt)
    ) {
      const e = r.spec.eipId
        ? n.eips.find((e) => e.id === r.spec.eipId)!
        : allocateEip(n, r, r.name, r.spec.bandwidthMbps);
      e.interfaceId = nic.id;
    }
  }
  delete r.spec.eipId;
}
export function releaseInterface(n: NetworkState, nic: NetworkInterface) {
  nic.releasedAt = new Date().toISOString();
  for (const e of n.eips.filter(
    (e) => e.interfaceId === nic.id && !e.releasedAt,
  )) {
    e.interfaceId = null;
    networkAudit(n, e, e.id, "eipUnbind");
  }
}
export function releaseResourceNetwork(n: NetworkState, uuid: string) {
  for (const nic of n.interfaces.filter(
    (i) => i.resourceUuid === uuid && !i.releasedAt,
  ))
    releaseInterface(n, nic);
}
export function makeNetwork(
  resources: Resource[],
  projects: Project[],
): NetworkState {
  const n: NetworkState = {
    vpcs: [],
    subnets: [],
    groups: [],
    interfaces: [],
    eips: [],
    tunnels: [],
    audit: [],
    ipSerial: 0,
  };
  for (const project of projects.filter((p) => !p.deletedAt))
    for (const region of REGIONS)
      ensureScope(n, { projectId: project.id, region });
  for (const r of resources) {
    if (r.deletedAt) continue;
    if (r.kind === "gpu_baremetal") {
      r.spec.vpc = "";
      r.spec.subnet = "";
      r.spec.securityGroups = undefined;
    }
    syncResourceNetwork(n, r);
  }
  n.audit = [];
  return n;
}
export function validVpcCidr(value: string) {
  const r = cidrRange(value);
  return !!r && r.prefix >= 8 && r.prefix <= 28 && privateCidr(value);
}
export function defaultRules(cidr: string): SecurityRule[] {
  return [
    {
      id: crypto.randomUUID(),
      direction: "inbound",
      action: "allow",
      protocol: "tcp",
      cidr,
      portFrom: 22,
      portTo: 22,
      priority: 1,
      description: "SSH",
    },
  ];
}
export function verifySubnet(parent: string, value: string) {
  const r = cidrRange(value);
  return !!r && r.prefix <= 29 && cidrContains(parent, value);
}
