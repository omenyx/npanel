"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";

type HostingLog = {
  id: string;
  adapter: string;
  operation: string;
  targetKind: string;
  targetKey: string;
  success: boolean;
  dryRun: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<HostingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      // Use the new endpoint for all logs
      const res = await fetch("http://127.0.0.1:3000/v1/hosting/services/logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setLogs(await res.json());
      } else {
        throw new Error("Failed to fetch logs");
      }
    } catch (err) {
      setError("Failed to load system logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = showErrorsOnly
    ? logs.filter((log) => !log.success)
    : logs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Activity className="h-6 w-6 text-blue-500" />
          Logs / Status
        </h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showErrorsOnly}
              onChange={(e) => setShowErrorsOnly(e.target.checked)}
              className="rounded border-zinc-800 bg-zinc-950 text-blue-600 focus:ring-blue-500"
            />
            Show Errors Only
          </label>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded text-sm transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-500 bg-red-900/10 border border-red-900/50 p-3 rounded">
            {error}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-zinc-400">
            <thead className="bg-zinc-950 text-xs uppercase text-zinc-500 font-medium">
                <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Operation</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Message</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
                {filteredLogs.length === 0 ? (
                    <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                            {logs.length === 0 ? "No logs found." : "No error logs found."}
                        </td>
                    </tr>
                ) : (
                    filteredLogs.map(log => {
                        const isToolError = log.errorMessage?.includes('tool') || log.errorMessage?.includes('command');
                        return (
                        <tr key={log.id} className={`hover:bg-zinc-800/50 ${isToolError ? 'bg-red-900/5' : ''}`}>
                            <td className="px-4 py-3 text-xs whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-zinc-300">{log.adapter}</td>
                            <td className="px-4 py-3 text-xs">{log.operation}</td>
                            <td className="px-4 py-3 text-xs text-zinc-500">
                                {log.targetKind}:{log.targetKey}
                            </td>
                            <td className="px-4 py-3">
                                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                                    log.success 
                                    ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50' 
                                    : 'bg-red-900/30 text-red-400 border border-red-900/50'
                                }`}>
                                    {log.success ? 'OK' : 'ERROR'}
                                </span>
                                {log.dryRun && <span className="ml-2 text-[10px] text-zinc-600">(dry)</span>}
                            </td>
                            <td className={`px-4 py-3 text-xs font-mono ${isToolError ? 'text-red-300 font-bold' : 'text-zinc-400'}`}>
                                {log.errorMessage || '-'}
                            </td>
                        </tr>
                        );
                    })
                )}
            </tbody>
        </table>
      </div>

    </div>
  );
}
