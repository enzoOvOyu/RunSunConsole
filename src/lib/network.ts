export function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (p) => !/^\d{1,3}$/.test(p) || Number(p) > 255 || String(Number(p)) !== p,
    )
  )
    return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}
export function ipv4String(value: number) {
  return [24, 16, 8, 0]
    .map((shift) => Math.floor(value / 2 ** shift) % 256)
    .join(".");
}
export function cidrRange(value: string) {
  const [address, prefix, ...extra] = value.split("/");
  const ip = ipv4Number(address);
  if (extra.length || ip === null || !/^(0|[1-9]\d?)$/.test(prefix || ""))
    return null;
  const bits = Number(prefix);
  if (bits > 32) return null;
  const size = 2 ** (32 - bits);
  if (ip % size !== 0) return null;
  return { start: ip, end: ip + size - 1, prefix: bits, size };
}
export function cidrContains(parent: string, child: string) {
  const a = cidrRange(parent),
    b = cidrRange(child);
  return !!a && !!b && a.start <= b.start && a.end >= b.end;
}
export function cidrOverlaps(a: string, b: string) {
  const x = cidrRange(a),
    y = cidrRange(b);
  return !!x && !!y && x.start <= y.end && y.start <= x.end;
}
export function privateCidr(value: string) {
  return ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((p) =>
    cidrContains(p, value),
  );
}
export function subnetCapacity(value: string) {
  const range = cidrRange(value);
  return range ? Math.max(0, range.size - 5) : 0;
}
export function isPublicIpv4(value: string) {
  const ip = ipv4Number(value);
  return (
    ip !== null &&
    ip > 0 &&
    ip < 3758096384 &&
    ![
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "127.0.0.0/8",
      "169.254.0.0/16",
      "0.0.0.0/8",
    ].some((c) => cidrContains(c, value + "/32"))
  );
}

export interface NetworkPacket {
  direction: "inbound" | "outbound";
  protocol: "tcp" | "udp" | "icmp";
  address: string;
  port?: number;
  established?: boolean;
  sameGroup?: boolean;
}
export function evaluateSecurityGroups(
  groups: import("../types/network").SecurityGroup[],
  packet: NetworkPacket,
) {
  if (ipv4Number(packet.address) === null) return "deny";
  if (packet.established) return "allow";
  const address = ipv4Number(packet.address)!;
  const matched = groups
    .flatMap((g) => g.rules)
    .filter((r) => {
      const range = cidrRange(r.cidr);
      return (
        r.direction === packet.direction &&
        (r.protocol === "all" || r.protocol === packet.protocol) &&
        range &&
        address >= range.start &&
        address <= range.end &&
        (r.portFrom === null ||
          (packet.port !== undefined &&
            packet.port >= r.portFrom &&
            packet.port <= r.portTo!))
      );
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.action === "deny" ? -1 : b.action === "deny" ? 1 : 0),
    );
  if (matched.length) return matched[0].action;
  if (packet.sameGroup && groups.some((g) => g.intraGroupPolicy === "allow"))
    return "allow";
  return packet.direction === "outbound" ? "allow" : "deny";
}

export function vpcNetworkType(vpc: {
  id: string;
  name: string;
  networkType?: "standard" | "baremetal";
}): "standard" | "baremetal" {
  if (vpc.networkType) return vpc.networkType;
  return /bare.?metal|(^|[-_])bm([-_]|$)/i.test(`${vpc.id} ${vpc.name}`)
    ? "baremetal"
    : "standard";
}

export function suggestedClusterCidrs(blocked: string[], currentPod = "", currentService = "") {
  const candidates = [
    ...Array.from({ length: 16 }, (_, index) => `10.${240 + index}.0.0/16`),
    ...Array.from({ length: 12 }, (_, index) => `172.${20 + index}.0.0/16`),
    ...Array.from({ length: 16 }, (_, index) => `192.168.${index * 16}.0/20`),
  ];
  const valid = (cidr: string) => !!cidrRange(cidr) && privateCidr(cidr) && blocked.every((range) => !cidrOverlaps(cidr, range));
  const podCidr = valid(currentPod) ? currentPod : candidates.find(valid);
  const serviceCidr = valid(currentService) && !cidrOverlaps(currentService, podCidr || "")
    ? currentService : candidates.find((cidr) => valid(cidr) && !cidrOverlaps(cidr, podCidr || ""));
  return podCidr && serviceCidr ? { podCidr, serviceCidr } : null;
}
