import type { PanelRole } from "@/app-shell/types";

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

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("npanel_access_token");
    window.localStorage.removeItem("npanel_refresh_token");
    window.localStorage.removeItem("npanel_user_email");
    window.localStorage.removeItem("npanel_user_role");
  } catch {
    return;
  }
}

