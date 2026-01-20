"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/shared/ui/cn";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";
import type { NavSection } from "@/app-shell/types";

type SidebarProps = {
  brand: React.ReactNode;
  sections: NavSection[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

export const Sidebar = React.memo(function Sidebar({
  brand,
  sections,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  setMobileOpen,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 border-r border-border bg-surface transition-transform md:static md:translate-x-0",
        collapsed ? "w-16" : "w-64",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        <div className={cn("flex items-center gap-2", collapsed && "justify-center w-full")}>
          {collapsed ? null : brand}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
          {onToggleCollapsed ? (
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              onClick={onToggleCollapsed}
              aria-label="Toggle sidebar"
            >
              <Menu className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto p-2">
        {sections.map((section) => (
          <div key={section.key} className="mb-3">
            {collapsed ? (
              <Separator className="my-2" />
            ) : (
              <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {section.label}
              </div>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-text-muted hover:bg-surface-hover hover:text-text-main",
                      collapsed && "justify-center px-2",
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {item.icon ? <item.icon className="h-4 w-4" /> : null}
                    {collapsed ? null : <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
});
