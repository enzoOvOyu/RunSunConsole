import type { Region, Kind, ResourceUuid, DisplayId } from "./domain";
export interface NetworkScope {
  projectId: string;
  region: Region;
}
export interface Vpc extends NetworkScope {
  deletedAt?: string | null;
  id: string;
  name: string;
  cidr: string;
  isDefault: boolean;
  networkType?: "standard" | "baremetal";
  createdAt: string;
}
export interface Subnet extends NetworkScope {
  deletedAt?: string | null;
  id: string;
  vpcId: string;
  name: string;
  cidr: string;
  zone: string;
  createdAt: string;
}
export interface SecurityRule {
  id: string;
  direction: "inbound" | "outbound";
  action: "allow" | "deny";
  protocol: "all" | "tcp" | "udp" | "icmp";
  cidr: string;
  portFrom: number | null;
  portTo: number | null;
  priority: number;
  description: string;
}
export interface SecurityGroup extends NetworkScope {
  deletedAt?: string | null;
  id: string;
  vpcId: string;
  name: string;
  description: string;
  intraGroupPolicy: "allow" | "deny";
  isDefault: boolean;
  rules: SecurityRule[];
  createdAt: string;
}
export interface NetworkInterface extends NetworkScope {
  id: string;
  resourceUuid: ResourceUuid;
  index: number;
  name: string;
  kind: Kind;
  vpcId: string;
  subnetId: string;
  privateIp: string;
  securityGroupIds: string[];
  releasedAt: string | null;
}
export interface ElasticIp extends NetworkScope {
  id: ResourceUuid;
  kind: "eip";
  displayId: DisplayId;
  name: string;
  address: string;
  bandwidthMbps: number;
  interfaceId: string | null;
  tunnelId: string | null;
  createdAt: string;
  releasedAt: string | null;
}
export interface IpsecTunnel extends NetworkScope {
  deletedAt?: string | null;
  id: string;
  name: string;
  vpcId: string;
  subnetId: string;
  eipId: string;
  privateIp: string;
  peerIp: string;
  localCidr: string;
  remoteCidr: string;
  ikeVersion: "ikev2";
  encryption: "aes256";
  integrity: "sha256";
  pskConfigured: boolean;
  enabled: boolean;
  createdAt: string;
}
export interface NetworkAudit extends NetworkScope {
  id: string;
  entityId: string;
  at: string;
  actor: string;
  action: string;
}
export interface NetworkState {
  vpcs: Vpc[];
  subnets: Subnet[];
  groups: SecurityGroup[];
  interfaces: NetworkInterface[];
  eips: ElasticIp[];
  tunnels: IpsecTunnel[];
  audit: NetworkAudit[];
  ipSerial: number;
}
export interface DeploymentNetworkOptions {
  vpcs: (Vpc & { subnets: (Subnet & { availableIps: number })[] })[];
  securityGroups: SecurityGroup[];
  eips: ElasticIp[];
}
export type VpcView = Vpc & { subnetCount: number; interfaceCount: number };
export type SubnetView = Subnet & { usedIps: number; availableIps: number };
export type SecurityGroupView = SecurityGroup & { interfaceCount: number };
export type EipView = ElasticIp & { boundName: string | null; boundHref: string | null; hourly: number };
export const NETWORK_QUOTA_METRICS = [
  "vpc",
  "subnet",
  "security_group",
  "tunnel",
  "ip",
] as const;
export type NetworkQuotaMetric = (typeof NETWORK_QUOTA_METRICS)[number];
export interface NetworkQuota {
  region: Region;
  metric: NetworkQuotaMetric;
  usedValue: number;
  limitValue: number;
  remaining: number;
  href: string;
}
