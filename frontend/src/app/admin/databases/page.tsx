"use client";

import * as React from "react";
import { Database } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";

type HostingService = {
  id: string;
  primaryDomain: string;
  planName: string | null;
  status: string;
};

export default function AdminDatabasesPage() {
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
        <Database className="h-6 w-6 text-primary" />
        Databases
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main">Services</div>
        <div className="text-xs text-text-muted mt-1">
          Database CRUD is available in the customer service view; this admin view provides auditability of assigned plans and statuses.
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm text-text-muted">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.map((s) => (
                <tr key={s.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-text-main">{s.primaryDomain}</td>
                  <td className="px-4 py-3">{s.planName ?? "basic"}</td>
                  <td className="px-4 py-3">{s.status}</td>
                </tr>
              ))}
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

