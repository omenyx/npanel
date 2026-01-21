import {
  Activity,
  FileText,
  Globe,
  KeyRound,
  LogIn,
  LayoutDashboard,
  Package,
  Server,
  Shield,
  Users,
  Webhook,
  ArrowRightLeft,
} from "lucide-react";
import type { NavSection } from "@/app-shell/types";

export const adminNavSections: NavSection[] = [
  {
    key: "general",
    label: "Dashboard",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        href: "/admin/dashboard",
        icon: LayoutDashboard,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "account-admin",
    label: "Account Administration",
    items: [
      {
        key: "accounts",
        label: "Account Management",
        href: "/admin/accounts",
        icon: Users,
        roles: ["ADMIN"],
      },
      {
        key: "impersonate",
        label: "Login as Customer",
        href: "/admin/accounts",
        icon: LogIn,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "security-ops",
    label: "Security & Operations",
    items: [
      {
        key: "security",
        label: "Security",
        href: "/admin/security",
        icon: Shield,
        roles: ["ADMIN"],
      },
      {
        key: "metrics",
        label: "Metrics & Logs",
        href: "/admin/metrics",
        icon: Activity,
        roles: ["ADMIN"],
      },
      {
        key: "backups",
        label: "Backups",
        href: "/admin/backups",
        icon: FileText,
        roles: ["ADMIN"],
      },
      {
        key: "logs-status",
        label: "Logs / Status",
        href: "/admin/logs",
        icon: Activity,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    key: "system",
    label: "Server & Infrastructure",
    items: [
      {
        key: "server",
        label: "Server / System Settings",
        href: "/admin/server",
        icon: Server,
        roles: ["ADMIN"],
      },
      {
        key: "dns-zones",
        label: "DNS Zones",
        href: "/admin/dns",
        icon: Globe,
        roles: ["ADMIN"],
      },
      {
        key: "packages",
        label: "Packages / Plans",
        href: "/admin/packages",
        icon: Package,
        roles: ["ADMIN"],
      },
      {
        key: "transfers",
        label: "Transfers",
        href: "/admin/transfers",
        icon: ArrowRightLeft,
        roles: ["ADMIN"],
      },
      {
        key: "api-integrations",
        label: "API & Integrations",
        href: "/admin/api",
        icon: Webhook,
        roles: ["ADMIN"],
      },
      {
        key: "access",
        label: "Access / Roles",
        href: "/admin/access",
        icon: KeyRound,
        roles: ["ADMIN"],
      },
    ],
  },
];
