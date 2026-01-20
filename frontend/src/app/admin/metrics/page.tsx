"use client";

import * as React from "react";
import { Activity, BarChart3 } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

type SystemStatusResponse = {
  systemStats?: {
    loadAvg: number[];
    memory: { percent: number };
    disk: { percent: number };
    uptime: number;
  };
};

type HostingLog = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
};

export default function AdminMetricsPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SystemStatusResponse | null>(null);
  const [logs, setLogs] = React.useState<HostingLog[]>([]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, logsData] = await Promise.all([
        requestJson<SystemStatusResponse>("/system/tools/status"),
        requestJson<HostingLog[]>("/v1/hosting/services/logs"),
      ]);
      setStatus(statusData);
      setLogs(logsData.slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          Metrics & Logs
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric label="Load Avg" value={status?.systemStats?.loadAvg?.[0]?.toFixed(2) ?? "—"} />
        <Metric label="Memory" value={status?.systemStats?.memory ? `${status.systemStats.memory.percent}%` : "—"} />
        <Metric label="Disk" value={status?.systemStats?.disk ? `${status.systemStats.disk.percent}%` : "—"} />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-text-muted" />
          <div>
            <div className="text-sm font-semibold text-text-main">Recent Logs</div>
            <div className="text-xs text-text-muted">Last 20 panel events.</div>
          </div>
        </div>
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
                  No logs available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-text-main">{value}</div>
    </div>
  );
}

