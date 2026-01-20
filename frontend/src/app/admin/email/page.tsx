"use client";

import * as React from "react";
import { Mail, RefreshCw } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

type HostingService = {
  id: string;
  primaryDomain: string;
  status: string;
};

export default function AdminEmailPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [services, setServices] = React.useState<HostingService[]>([]);
  const [selected, setSelected] = React.useState<HostingService | null>(null);
  const [credentials, setCredentials] = React.useState<{ mailboxPassword: string; ftpPassword: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<HostingService[]>("/v1/hosting/services");
      setServices(data);
      if (!selected && data.length) setSelected(data[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load services.");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const init = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setCredentials(null);
    try {
      const payload = await requestJson<any>(`/v1/hosting/services/${selected.id}/credentials/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setCredentials({ mailboxPassword: payload.mailboxPassword, ftpPassword: payload.ftpPassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          Email
        </h1>
        <Button variant="secondary" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="card p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-text">Hosting Service</label>
            <select
              className="input-field"
              value={selected?.id ?? ""}
              onChange={(e) => {
                const next = services.find((s) => s.id === e.target.value) ?? null;
                setSelected(next);
                setCredentials(null);
              }}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.primaryDomain} ({s.status})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={init} disabled={!selected || busy}>
              {busy ? "Setting…" : "Set Initial Mailbox Password"}
            </Button>
          </div>
        </div>

        {credentials ? (
          <div className="rounded-[var(--radius-card)] border border-border bg-surface-hover p-3 text-sm text-text-main">
            <div className="font-semibold mb-2">Generated Credentials</div>
            <div className="grid gap-1 text-xs">
              <div>
                Mailbox password:{" "}
                <span className="font-mono">{credentials.mailboxPassword}</span>
              </div>
              <div>
                FTP password:{" "}
                <span className="font-mono">{credentials.ftpPassword}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

