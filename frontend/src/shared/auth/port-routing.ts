/**
 * Port detection and routing utilities
 * 
 * Port mapping (matches nginx configuration):
 * - 2082: Customer HTTP
 * - 2083: Customer HTTPS  
 * - 2086: Admin HTTP
 * - 2087: Admin HTTPS
 * - 8080: Mixed (development, uses stored role)
 * - 3001: Frontend dev server (mixed)
 * - 80/443: Default HTTP/HTTPS (mixed)
 */

export type AccessMode = "admin" | "customer" | "mixed";

/**
 * Detect the access mode based on the current window location
 */
export function detectAccessMode(): AccessMode {
  if (typeof window === "undefined") {
    return "mixed";
  }

  const host = window.location.host;
  const portMatch = host.split(":")[1];
  const port = portMatch ? parseInt(portMatch, 10) : 
    (window.location.protocol === "https:" ? 443 : 80);
  
  if (port === 2086 || port === 2087) {
    return "admin";
  } else if (port === 2082 || port === 2083) {
    return "customer";
  } else {
    return "mixed";
  }
}

/**
 * Check if a user role is allowed on the current port
 */
export function isRoleAllowedOnCurrentPort(role: string): boolean {
  const mode = detectAccessMode();
  
  if (mode === "mixed") {
    return true; // All roles allowed on mixed ports
  } else if (mode === "admin") {
    return role === "ADMIN";
  } else if (mode === "customer") {
    return role === "CUSTOMER";
  }
  
  return false;
}

/**
 * Get the appropriate dashboard path for a role
 */
export function getDashboardPath(role: string): string {
  return role === "CUSTOMER" ? "/customer" : "/admin";
}

/**
 * Get the redirect URL for a given role based on current port
 */
export function getRedirectUrlForRole(role: string): string | null {
  if (!isRoleAllowedOnCurrentPort(role)) {
    return null; // Role not allowed on this port
  }
  
  return getDashboardPath(role);
}

/**
 * Check if current access is on an admin-only port
 */
export function isAdminPortAccess(): boolean {
  return detectAccessMode() === "admin";
}

/**
 * Check if current access is on a customer-only port
 */
export function isCustomerPortAccess(): boolean {
  return detectAccessMode() === "customer";
}

/**
 * Get human-readable description of current access mode
 */
export function getAccessModeLabel(): string {
  const mode = detectAccessMode();
  
  if (mode === "admin") {
    return "Admin Portal";
  } else if (mode === "customer") {
    return "Customer Portal";
  } else {
    return "Multi-Purpose Portal";
  }
}

/**
 * Get the protocol badge for current access
 */
export function getProtocolBadge(): { label: string; icon: string; color: string } {
  if (typeof window === "undefined") {
    return { label: "HTTP", icon: "🔓", color: "text-amber-400" };
  }

  const isHttps = window.location.protocol === "https:";
  return isHttps 
    ? { label: "HTTPS", icon: "🔒", color: "text-emerald-400" }
    : { label: "HTTP", icon: "🔓", color: "text-amber-400" };
}
