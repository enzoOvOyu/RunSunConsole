import {
  LayoutDashboard,
  PlusCircle,
  Layers,
  Briefcase,
  Terminal,
  Database,
  CloudUpload,
  Wallet,
  FolderKanban,
  Gauge,
  ChartNoAxesCombined,
  Ticket,
  Container,
  AppWindow,
  Scaling,
  Files,
  HardDrive,
  ReceiptText,
  TicketPercent,
  Network,
  Globe2,
  ShieldCheck,
  Cable,
  KeyRound,
  ClipboardList,
} from "lucide-react";
import { KINDS, type Role } from "../../types/domain";
import { KIND_META } from "../../lib/ids";
import { canSeeNavPath } from "../../lib/rbac";
import { t } from "../../i18n";
export interface NavItem {
  id: string;
  path: string;
  label: () => string;
  icon: typeof LayoutDashboard;
  color?: string;
}
export interface NavGroup {
  id: string;
  label: () => string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
  direct?: boolean;
}
const itemIcons: Record<string, typeof LayoutDashboard> = {
  vpcs: Network,
  eips: Globe2,
  "security-groups": ShieldCheck,
  tunnels: Cable,
  "operation-logs": ClipboardList,
  projects: FolderKanban,
  quotas: Gauge,
  cost: ChartNoAxesCombined,
  tickets: Ticket,
  images: Container,
  apps: AppWindow,
  scaling: Scaling,
  "ssh-keys": KeyRound,
  block: HardDrive,
  file: Files,
  object: CloudUpload,
  bills: ReceiptText,
  vouchers: TicketPercent,
};
export function buildGroups(role: Role): NavGroup[] {
  const groups: NavGroup[] = [
    {
      id: "overview",
      label: () => t("nav.overview"),
      icon: LayoutDashboard,
      direct: true,
      items: [
        {
          id: "overview",
          path: "/overview",
          label: () => t("nav.overview"),
          icon: LayoutDashboard,
        },
      ],
    },
    {
      id: "deployment",
      label: () => t("nav.deployment"),
      icon: PlusCircle,
      items: KINDS.map((kind) => ({
        id: `deploy-${kind}`,
        path: `/deployment/${KIND_META[kind].deployKey}`,
        label: () => `${t("common.create")} ${t(`common.${kind}`)}`,
        icon: KIND_META[kind].icon,
        color: KIND_META[kind].color,
      })),
    },
    {
      id: "resources",
      label: () => t("nav.resources"),
      icon: Layers,
      items: KINDS.map((kind) => ({
        id: kind,
        path: `/resources/${KIND_META[kind].routeKey}`,
        label: () => t(`common.${kind}`),
        icon: KIND_META[kind].icon,
        color: KIND_META[kind].color,
      })),
    },
    ...[
      {
        id: "network",
        icon: Network,
        items: ["vpcs", "eips", "security-groups", "tunnels"],
      },
      {
        id: "ops",
        icon: Briefcase,
        items: ["projects", "quotas", "tickets", "operation-logs"],
      },
      {
        id: "workbench",
        icon: Terminal,
        items: ["images", "apps", "scaling", "ssh-keys"],
      },
      {
        id: "storage",
        icon: Database,
        items: ["block", "file", "object"],
      },
      { id: "billing", icon: Wallet, items: ["cost", "bills", "vouchers"] },
    ].map((group) => ({
      id: group.id,
      label: () => t(`nav.${group.id}`),
      icon: group.icon,
      items: group.items.map((id) => ({
        id,
        path: `/${group.id}/${id}`,
        label: () => t(`nav.${id}`),
        icon: itemIcons[id],
      })),
    })),
  ];
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => canSeeNavPath(role, i.path)),
    }))
    .filter((g) => g.items.length);
}
