"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Server,
  Users,
  Package,
  ArrowRightLeft,
  Activity,
  LogOut,
  Menu,
  Globe,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = window.localStorage.getItem("npanel_access_token");
    } catch {
      token = null;
    }
    if (!token) {
      router.push("/login");
      return;
    }
    // Simple decoding to check role would be better, but for now just presence
    if (!authorized) {
      setAuthorized(true);
    }
  }, [router, authorized]);

  if (!authorized) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-text-muted">
        <div className="animate-pulse">Loading admin context...</div>
      </div>
    );
  }

  const navItems = [
    {
      label: "Server",
      href: "/admin/server",
      icon: Server,
    },
    {
      label: "Accounts",
      href: "/admin/accounts",
      icon: Users,
    },
    {
      label: "Packages",
      href: "/admin/packages",
      icon: Package,
    },
    {
      label: "Transfers",
      href: "/admin/transfers",
      icon: ArrowRightLeft,
    },
    {
      label: "DNS",
      href: "/admin/dns",
      icon: Globe,
    },
    {
      label: "Logs / Status",
      href: "/admin/logs",
      icon: Activity,
    },
  ];

  const handleLogout = () => {
    try {
      window.localStorage.removeItem("npanel_access_token");
      window.localStorage.removeItem("npanel_refresh_token");
    } catch {
      return;
    }
    router.push("/login");
  };

  return (
    <div className="flex h-screen w-full bg-background text-text-main font-sans selection:bg-primary/30 selection:text-primary">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-border bg-surface transition-transform duration-200 md:static md:translate-x-0 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2 font-bold text-text-main">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[10px] text-primary-fg">
              N
            </div>
            <span>Panel</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-text-muted hover:text-text-main"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col justify-between h-[calc(100vh-3.5rem)]">
          <nav className="flex-1 space-y-1 p-2">
            <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Management
            </div>
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-main"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border p-4 space-y-2">
            <div className="flex items-center justify-between px-2">
                <span className="text-xs text-text-muted font-medium">Theme</span>
                <ThemeToggle />
            </div>
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 text-sm text-text-muted hover:bg-surface-hover hover:text-danger transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center border-b border-border bg-surface px-4 md:hidden">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="text-text-muted"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="ml-3 font-semibold text-text-main">NPanel</span>
        </header>

        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
