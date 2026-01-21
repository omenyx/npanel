import type { PanelRole } from "@/app-shell/types";

export type ImpersonationContext = {
  sessionId: string;
  adminId: string;
  adminEmail: string;
  customerId: string;
  customerEmail: string;
  issuedAt: string;
  expiresAt: string;
};

export function getStoredRole(): PanelRole | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem("npanel_user_role");
    if (
      value === "ADMIN" ||
      value === "RESELLER" ||
      value === "SUPPORT" ||
      value === "CUSTOMER"
    ) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function getImpersonationContext(): ImpersonationContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("npanel_impersonation");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImpersonationContext>;
    if (
      typeof parsed.sessionId === "string" &&
      typeof parsed.adminId === "string" &&
      typeof parsed.adminEmail === "string" &&
      typeof parsed.customerId === "string" &&
      typeof parsed.customerEmail === "string" &&
      typeof parsed.issuedAt === "string" &&
      typeof parsed.expiresAt === "string"
    ) {
      return parsed as ImpersonationContext;
    }
    return null;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return getImpersonationContext() !== null;
}

export function startImpersonation(input: {
  impersonation: ImpersonationContext;
}) {
  if (typeof window === "undefined") return;
  try {
    const email = window.localStorage.getItem("npanel_user_email");
    const role = window.localStorage.getItem("npanel_user_role");

    if (email) window.localStorage.setItem("npanel_admin_user_email", email);
    if (role) window.localStorage.setItem("npanel_admin_user_role", role);

    window.localStorage.setItem("npanel_user_role", "CUSTOMER");
    window.localStorage.setItem("npanel_impersonation", JSON.stringify(input.impersonation));
  } catch {
    return;
  }
}

export function exitImpersonation() {
  if (typeof window === "undefined") return;
  try {
    const email = window.localStorage.getItem("npanel_admin_user_email");
    const role = window.localStorage.getItem("npanel_admin_user_role");

    window.localStorage.removeItem("npanel_impersonation");
    window.localStorage.removeItem("npanel_admin_user_email");
    window.localStorage.removeItem("npanel_admin_user_role");

    if (email) window.localStorage.setItem("npanel_user_email", email);
    if (role) window.localStorage.setItem("npanel_user_role", role);
  } catch {
    return;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("npanel_user_email");
    window.localStorage.removeItem("npanel_user_role");
    window.localStorage.removeItem("npanel_impersonation");
    window.localStorage.removeItem("npanel_admin_user_email");
    window.localStorage.removeItem("npanel_admin_user_role");
  } catch {
    return;
  }
}
