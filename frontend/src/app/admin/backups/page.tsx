"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

export default function AdminBackupsPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string>("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<{ files: string[] }>("/system/tools/logs/files");
      setFiles(data.files || []);
      if (!selected && data.files?.length) setSelected(data.files[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs.");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    const run = async () => {
      if (!selected) return;
      try {
        const data = await requestJson<{ content: string }>(
          `/system/tools/logs/content?path=${encodeURIComponent(selected)}`,
        );
        setContent(data.content);
      } catch {
        setContent("");
      }
    };
    run();
  }, [selected]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          Backups
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

      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main">Backup Operations</div>
        <div className="text-xs text-text-muted mt-1">
          This server currently exposes backup observability via server logs.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card p-4 md:col-span-1">
          <div className="text-sm font-semibold text-text-main mb-3">Logs</div>
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="input-field"
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="card p-4 md:col-span-2">
          <div className="text-sm font-semibold text-text-main mb-3">Log Output</div>
          <pre className="h-[420px] overflow-auto rounded-[var(--radius-card)] border border-border bg-black p-3 text-xs text-white">
            {content || (loading ? "Loading…" : "No content.")}
          </pre>
        </div>
      </div>
    </div>
  );
}
