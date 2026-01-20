import {
  Activity,
  BarChart3,
  Database,
  FileText,
  Folder,
  Globe,
  KeyRound,
  LayoutDashboard,
  Package,
  Server,
  Shield,
  Users,
  Webhook,
  ArrowRightLeft,
  Mail,
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
    key: "hosting",
    label: "Hosting",
    items: [
      {
        key: "accounts",
        label: "Account Management",
        href: "/admin/accounts",
        icon: Users,
        roles: ["ADMIN"],
      },
      {
        key: "domains",
        label: "Domains",
        href: "/admin/dns",
        icon: Globe,
        roles: ["ADMIN"],
      },
      {
        key: "email",
        label: "Email",
        href: "/admin/email",
        icon: Mail,
        roles: ["ADMIN"],
      },
      {
        key: "databases",
        label: "Databases",
        href: "/admin/databases",
        icon: Database,
        roles: ["ADMIN"],
      },
      {
        key: "files",
        label: "Files",
        href: "/admin/files",
        icon: Folder,
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
        icon: BarChart3,
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
    label: "System",
    items: [
      {
        key: "server",
        label: "Server / System Settings",
        href: "/admin/server",
        icon: Server,
        roles: ["ADMIN"],
      },
      {
        key: "packages",
        label: "Packages",
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
        label: "Access",
        href: "/admin/access",
        icon: KeyRound,
        roles: ["ADMIN"],
      },
    ],
  },
];

