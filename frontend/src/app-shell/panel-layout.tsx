"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/app-shell/sidebar";
import { Topbar } from "@/app-shell/topbar";
import type { NavSection, PanelRole } from "@/app-shell/types";
import { getAccessToken } from "@/shared/api/api-client";
import { clearSession, getStoredRole } from "@/shared/auth/session";

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

  React.useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.push("/login");
      return;
    }
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

  const handleLogout = React.useCallback(() => {
    clearSession();
    router.push("/login");
  }, [router]);

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
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
