"use client";

import * as React from "react";
import { Bell, Menu, UserCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import type { NavSection } from "@/app-shell/types";
import { Breadcrumbs } from "@/app-shell/breadcrumbs";
import { CommandPalette } from "@/app-shell/command-palette";

type TopbarProps = {
  sections: NavSection[];
  onOpenMobileMenu: () => void;
  onLogout: () => void;
};

export const Topbar = React.memo(function Topbar({
  sections,
  onOpenMobileMenu,
  onLogout,
}: TopbarProps) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const email = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem("npanel_user_email");
    } catch {
      return null;
    }
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-surface px-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onOpenMobileMenu}
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex flex-1 flex-col">
          <Breadcrumbs sections={sections} />
        </div>

        <Button
          variant="secondary"
          className="hidden md:inline-flex h-9 px-3 text-xs"
          onClick={() => setPaletteOpen(true)}
        >
          Search
          <span className="ml-2 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
            Ctrl K
          </span>
        </Button>

        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-4 w-4 text-text-muted" />
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="User menu">
              <UserCircle className="h-5 w-5 text-text-muted" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {email ? <span className="truncate">{email}</span> : "Signed in"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        sections={sections}
      />
    </>
  );
});
