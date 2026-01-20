"use client";

import * as React from "react";
import { Folder } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";

type HostingService = {
  id: string;
  primaryDomain: string;
  status: string;
};

export default function AdminFilesPage() {
  const [error, setError] = React.useState<string | null>(null);
  const [services, setServices] = React.useState<HostingService[]>([]);

  React.useEffect(() => {
    const run = async () => {
      setError(null);
      try {
        const data = await requestJson<HostingService[]>("/v1/hosting/services");
        setServices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load services.");
      }
    };
    run();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Folder className="h-6 w-6 text-primary" />
        Files
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main">File Manager</div>
        <div className="text-xs text-text-muted mt-1">
          File operations are executed on the server and must be exposed via a dedicated API to avoid privilege escalation. This view lists active services as the scope for file operations.
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm text-text-muted">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Web Root</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((s) => {
                const username = `u_${(s.primaryDomain.toLowerCase().split(".")[0] || "site")
                  .replace(/[^a-z0-9]/g, "")
                  .slice(0, 8) || "site"}`;
                return (
                  <tr key={s.id} className="table-row">
                    <td className="px-4 py-3 font-medium text-text-main">{s.primaryDomain}</td>
                    <td className="px-4 py-3">{s.status}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text-main">
                      /home/{username}/public_html
                    </td>
                  </tr>
                );
              })}
              {services.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-text-muted">
                    No services found.
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

