"use client";

import * as React from "react";
import { Webhook } from "lucide-react";
import { env } from "@/shared/config/env";
import { requestJson } from "@/shared/api/api-client";

type MeResponse = { id: string; email: string; role: string };

export default function AdminApiPage() {
  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const run = async () => {
      setError(null);
      try {
        const data = await requestJson<MeResponse>("/v1/auth/me");
        setMe(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session.");
      }
    };
    run();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Webhook className="h-6 w-6 text-primary" />
        API & Integrations
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-text-main">API Base URL</div>
        <pre className="rounded-[var(--radius-card)] border border-border bg-surface-hover p-3 text-xs text-text-main overflow-x-auto">
          {env.apiBaseUrl}
        </pre>
        <div className="text-xs text-text-muted">
          Client requests use a Bearer access token stored in browser storage.
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-text-main">Current Session</div>
        {me ? (
          <div className="grid gap-2 text-sm text-text-muted">
            <div>
              Email: <span className="text-text-main">{me.email}</span>
            </div>
            <div>
              Role: <span className="text-text-main">{me.role}</span>
            </div>
            <div>
              ID: <span className="font-mono text-text-main">{me.id}</span>
            </div>
          </div>
        ) : (
          <div className="text-sm text-text-muted">Loading…</div>
        )}
      </div>
    </div>
  );
}

