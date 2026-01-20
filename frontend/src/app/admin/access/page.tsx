"use client";

import * as React from "react";
import { KeyRound } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

export default function AdminAccessPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [publicKey, setPublicKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await requestJson<{ publicKey: string }>("/system/tools/ssh-key");
        setPublicKey(data.publicKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load key.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <KeyRound className="h-6 w-6 text-primary" />
        Access
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-text-main">System SSH Public Key</div>
        <div className="text-xs text-text-muted">
          Use this key to authorize migrations (source servers) or automation on the host.
        </div>
        <pre className="rounded-[var(--radius-card)] border border-border bg-surface-hover p-3 text-xs text-text-main overflow-x-auto">
          {loading ? "Loading…" : publicKey ?? "—"}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              if (publicKey) navigator.clipboard.writeText(publicKey);
            }}
            disabled={!publicKey}
          >
            Copy
          </Button>
        </div>
      </div>
    </div>
  );
}

