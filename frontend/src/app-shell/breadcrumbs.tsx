"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/ui/cn";
import type { NavSection } from "@/app-shell/types";

type BreadcrumbsProps = {
  sections: NavSection[];
  className?: string;
};

export function Breadcrumbs({ sections, className }: BreadcrumbsProps) {
  const pathname = usePathname();
  const active =
    sections
      .flatMap((s) => s.items.map((i) => ({ section: s, item: i })))
      .find(({ item }) =>
        item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`),
      ) ?? null;

  if (!active) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center text-xs text-text-muted", className)}
    >
      <Link href={active.section.items[0]?.href ?? "/"} className="hover:text-text-main">
        {active.section.label}
      </Link>
      <ChevronRight className="mx-2 h-3.5 w-3.5" />
      <span className="text-text-main">{active.item.label}</span>
    </nav>
  );
}

