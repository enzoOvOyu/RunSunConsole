import type { Resource, Usage } from "../../types/domain";
import type {
  Vpc,
  SubnetView,
  NetworkInterface,
  SecurityGroup,
  ElasticIp,
  IpsecTunnel,
  NetworkAudit,
} from "../../types/network";
export type NetworkKind = "vpcs" | "eips" | "security-groups" | "tunnels";
export interface InterfaceView extends NetworkInterface {
  resource?: Resource;
  eip?: ElasticIp | null;
  vpc?: Vpc;
  subnet?: SubnetView;
  groups?: SecurityGroup[];
}
export type NetworkRecord = (Vpc | SecurityGroup | ElasticIp | IpsecTunnel) & {
  deletedAt?: string | null;
  subnetCount?: number;
  interfaceCount?: number;
  boundName?: string | null;
  hourly?: number;
  gatewayIp?: string | null;
};
export type NetworkDetail = NetworkRecord & {
  subnets?: SubnetView[];
  groups?: SecurityGroup[];
  interfaces?: InterfaceView[];
  tunnels?: IpsecTunnel[];
  audit: NetworkAudit[];
  usage?: Usage[];
};
export function uiPath(kind: NetworkKind) {
  return `/network/${kind}`;
}
export function navKey(kind: NetworkKind) {
  return kind;
}
