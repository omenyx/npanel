"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/app-shell/sidebar";
import { Topbar } from "@/app-shell/topbar";
import type { NavSection, PanelRole } from "@/app-shell/types";
import { requestJson } from "@/shared/api/api-client";
import {
  clearSession,
  exitImpersonation,
  getImpersonationContext,
  getStoredRole,
  isImpersonating,
  type ImpersonationContext,
} from "@/shared/auth/session";

type PanelLayoutProps = {
  brand: React.ReactNode;
  sections: NavSection[];
  children: React.ReactNode;
  allowedRoles?: PanelRole[];
};

export function PanelLayout({
  brand,
  sections,
  children,
  allowedRoles,
}: PanelLayoutProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [impersonation, setImpersonation] = React.useState<ImpersonationContext | null>(
    null,
  );

  React.useEffect(() => {
    // Initialize impersonation context after hydration
    setImpersonation(getImpersonationContext());
  }, []);

  React.useEffect(() => {
    if (allowedRoles && allowedRoles.length > 0) {
      const role = getStoredRole();
      if (!role || !allowedRoles.includes(role)) {
        const target = role === "CUSTOMER" ? "/customer" : "/admin";
        router.replace(target);
        return;
      }
    }
    setAuthorized(true);
  }, [allowedRoles, router]);
  
  // Fallback: if not authorized after 2 seconds, redirect to login
  React.useEffect(() => {
    if (!authorized) {
      const timer = setTimeout(() => {
        if (!authorized) {
          router.replace("/login");
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [authorized, router]);

  const handleLogout = React.useCallback(() => {
    clearSession();
    router.push("/login");
  }, [router]);

  const handleExitImpersonation = React.useCallback(async () => {
    try {
      if (isImpersonating()) {
        await requestJson("/v1/auth/impersonation/end", { method: "POST" });
      }
    } catch {
    } finally {
      exitImpersonation();
      setImpersonation(null);
      router.replace("/admin");
    }
  }, [router]);

  React.useEffect(() => {
    const onStorage = () => setImpersonation(getImpersonationContext());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const openMobileMenu = React.useCallback(() => setMobileOpen(true), []);
  const toggleCollapsed = React.useCallback(() => setCollapsed((v) => !v), []);

  if (!authorized) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-text-muted">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background text-text-main font-sans selection:bg-primary/30 selection:text-primary">
      <Sidebar
        brand={brand}
        sections={sections}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          sections={sections}
          onOpenMobileMenu={openMobileMenu}
          onLogout={handleLogout}
        />
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {impersonation && (
              <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-text-main">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">
                      You are impersonating this customer as ADMIN
                    </div>
                    <div className="text-xs text-text-muted">
                      Admin: {impersonation.adminEmail} • Customer:{" "}
                      {impersonation.customerEmail} • Expires:{" "}
                      {new Date(impersonation.expiresAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={handleExitImpersonation}
                    className="btn-secondary"
                  >
                    Exit impersonation
                  </button>
                </div>
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
