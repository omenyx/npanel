import {
  Activity,
  Database,
  FileText,
  Folder,
  Globe,
  LayoutDashboard,
  Mail,
  Shield,
  Webhook,
  ArrowRightLeft,
} from "lucide-react";
import type { NavSection } from "@/app-shell/types";

export const customerNavSections: NavSection[] = [
  {
    key: "general",
    label: "Dashboard",
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        href: "/customer",
        icon: LayoutDashboard,
        roles: ["CUSTOMER"],
      },
    ],
  },
  {
    key: "hosting",
    label: "Hosting",
    items: [
      {
        key: "domains",
        label: "Domains",
        href: "/customer/domains",
        icon: Globe,
        roles: ["CUSTOMER"],
      },
      {
        key: "email",
        label: "Email",
        href: "/customer/email",
        icon: Mail,
        roles: ["CUSTOMER"],
      },
      {
        key: "databases",
        label: "Databases",
        href: "/customer/databases",
        icon: Database,
        roles: ["CUSTOMER"],
      },
      {
        key: "files",
        label: "Files",
        href: "/customer/files",
        icon: Folder,
        roles: ["CUSTOMER"],
      },
    ],
  },
  {
    key: "ops",
    label: "Operations",
    items: [
      {
        key: "metrics",
        label: "Metrics & Logs",
        href: "/customer/metrics",
        icon: Activity,
        roles: ["CUSTOMER"],
      },
      {
        key: "backups",
        label: "Backups",
        href: "/customer/backups",
        icon: FileText,
        roles: ["CUSTOMER"],
      },
      {
        key: "security",
        label: "Security",
        href: "/customer/security",
        icon: Shield,
        roles: ["CUSTOMER"],
      },
      {
        key: "transfers",
        label: "Transfers",
        href: "/customer/migrations",
        icon: ArrowRightLeft,
        roles: ["CUSTOMER"],
      },
      {
        key: "api-integrations",
        label: "API & Integrations",
        href: "/customer/api",
        icon: Webhook,
        roles: ["CUSTOMER"],
      },
    ],
  },
];

