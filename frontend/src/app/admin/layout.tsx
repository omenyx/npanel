"use client";

import * as React from "react";
import { PanelLayout } from "@/app-shell/panel-layout";
import { adminNavSections } from "@/app-shell/nav/admin";
import { filterNavSectionsForRole } from "@/app-shell/nav/filter";
import { getStoredRole } from "@/shared/auth/session";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = React.useMemo(() => getStoredRole(), []);
  const sections = React.useMemo(
    () => filterNavSectionsForRole(adminNavSections, role),
    [role],
  );

  return (
    <PanelLayout
      brand={
        <div className="flex items-center gap-2 font-bold text-text-main">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[10px] text-primary-fg">
            N
          </div>
          <span>Panel</span>
        </div>
      }
      sections={sections}
      allowedRoles={["ADMIN"]}
    >
      {children}
    </PanelLayout>
  );
}
