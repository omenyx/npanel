import type { LucideIcon } from "lucide-react";

export type PanelRole = "ADMIN" | "RESELLER" | "SUPPORT" | "CUSTOMER";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  roles?: PanelRole[];
};

export type NavSection = {
  key: string;
  label: string;
  items: NavItem[];
};

