"use client";

import * as React from "react";
import { Activity } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";

type MigrationJob = { id: string; name: string; status: string };

export default function CustomerMetricsPage() {
  const [jobs, setJobs] = React.useState<MigrationJob[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const run = async () => {
      setError(null);
      try {
        const data = await requestJson<MigrationJob[]>("/v1/customer/migrations");
        setJobs(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load activity.");
      }
    };
    run();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        Metrics & Logs
      </h1>
      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main mb-2">Recent Jobs</div>
        <div className="text-xs text-text-muted mb-4">
          Customer-facing activity currently includes migration execution logs.
        </div>
        <div className="space-y-2">
          {jobs.slice(0, 10).map((j) => (
            <div key={j.id} className="rounded-[var(--radius-card)] border border-border bg-surface-hover px-3 py-2 text-sm text-text-main flex justify-between">
              <span>{j.name}</span>
              <span className="text-xs text-text-muted">{j.status}</span>
            </div>
          ))}
          {jobs.length === 0 ? (
            <div className="text-sm text-text-muted">No activity yet.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

