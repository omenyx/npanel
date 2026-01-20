"use client";

import * as React from "react";
import { Activity, AlertTriangle, HardDrive, Server, Users } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

type ToolStatus = {
  name: string;
  available: boolean;
  packageHint?: string;
};

type SystemStatusResponse = {
  tools: ToolStatus[];
  systemStats?: {
    loadAvg: number[];
    memory: { percent: number; used: number; total: number };
    disk: { percent: number; used: number; total: number };
    uptime: number;
  };
  serverInfo: {
    defaultIpv4: string;
    dnsBackend: string;
    mailBackend: string;
    ftpBackend: string;
  };
};

type HostingService = {
  id: string;
  status: string;
  primaryDomain: string;
};

type HostingLog = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
};

export default function AdminDashboardPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SystemStatusResponse | null>(null);
  const [services, setServices] = React.useState<HostingService[]>([]);
  const [logs, setLogs] = React.useState<HostingLog[]>([]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, servicesData, logsData] = await Promise.all([
        requestJson<SystemStatusResponse>("/system/tools/status"),
        requestJson<HostingService[]>("/v1/hosting/services"),
        requestJson<HostingLog[]>("/v1/hosting/services/logs"),
      ]);
      setStatus(statusData);
      setServices(servicesData);
      setLogs(logsData.slice(0, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const activeCount = services.filter((s) => s.status === "active").length;
  const pendingCount = services.filter((s) => s.status === "provisioning").length;

  const missingTools =
    status?.tools?.filter((t) => t.available === false).slice(0, 6) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <Server className="h-6 w-6 text-primary" />
          Dashboard
        </h1>
        <Button variant="secondary" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Accounts"
          value={`${activeCount}`}
          sub={`${pendingCount} provisioning`}
        />
        <StatCard
          label="Load Avg (1m)"
          value={
            status?.systemStats?.loadAvg?.[0] !== undefined
              ? status.systemStats.loadAvg[0].toFixed(2)
              : "—"
          }
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Memory"
          value={
            status?.systemStats?.memory
              ? `${status.systemStats.memory.percent}%`
              : "—"
          }
          sub={
            status?.systemStats?.memory
              ? `${formatBytes(status.systemStats.memory.used)} / ${formatBytes(status.systemStats.memory.total)}`
              : undefined
          }
        />
        <StatCard
          label="Disk"
          value={
            status?.systemStats?.disk
              ? `${status.systemStats.disk.percent}%`
              : "—"
          }
          sub={
            status?.systemStats?.disk
              ? `${formatBytes(status.systemStats.disk.used)} / ${formatBytes(status.systemStats.disk.total)}`
              : undefined
          }
          icon={<HardDrive className="h-4 w-4" />}
        />
      </div>

      {missingTools.length > 0 ? (
        <div className="card p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
            <div className="space-y-1">
              <div className="text-sm font-semibold text-text-main">
                System Alerts
              </div>
              <div className="text-xs text-text-muted">
                Some required tools are missing; provisioning may fail.
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {missingTools.map((t) => (
              <div
                key={t.name}
                className="rounded-[var(--radius-card)] border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-text-main"
              >
                <div className="font-mono">{t.name}</div>
                {t.packageHint ? (
                  <div className="text-text-muted">Install: {t.packageHint}</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-text-main">
            Recent Activity
          </div>
          <div className="text-xs text-text-muted">
            Latest provisioning/lifecycle events.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text-muted">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id} className="table-row">
                  <td className="px-4 py-3 text-xs font-mono">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs uppercase">{l.level}</td>
                  <td className="px-4 py-3 text-text-main">{l.message}</td>
                </tr>
              ))}
              {!loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-text-muted">
                    No recent activity.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </div>
        {icon ? <div className="text-text-muted">{icon}</div> : null}
      </div>
      <div className="mt-2 text-2xl font-bold text-text-main">{value}</div>
      {sub ? <div className="mt-1 text-xs text-text-muted">{sub}</div> : null}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

