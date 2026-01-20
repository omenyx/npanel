"use client";

import * as React from "react";
import { Plus, RefreshCw, Save, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { DnsRecord, DnsRecordType, DnsZoneName } from "@/features/domains/types";
import { filterEmptyRecords, getSupportedRecordTypes, validateRecord } from "@/features/domains/validators";

type RecordEditorProps = {
  zoneName: DnsZoneName;
  records: DnsRecord[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  onRefresh: () => void;
  onChangeRecords: (next: DnsRecord[]) => void;
  onSave: (records: DnsRecord[]) => Promise<void>;
};

export function RecordEditor({
  zoneName,
  records,
  loading,
  saving,
  error,
  success,
  onRefresh,
  onChangeRecords,
  onSave,
}: RecordEditorProps) {
  const [localError, setLocalError] = React.useState<string | null>(null);
  const recordTypes = React.useMemo(() => getSupportedRecordTypes(), []);

  const addRecord = () => {
    onChangeRecords([...records, { name: "@", type: "A", data: "", ttl: 300 }]);
  };

  const removeRecord = (index: number) => {
    const next = records.slice();
    next.splice(index, 1);
    onChangeRecords(next);
  };

  const updateRecord = (
    index: number,
    patch: Partial<Pick<DnsRecord, "name" | "type" | "data" | "ttl">>,
  ) => {
    const next = records.slice();
    next[index] = { ...next[index], ...patch };
    onChangeRecords(next);
  };

  const handleSave = async () => {
    setLocalError(null);
    const candidates = filterEmptyRecords(records);
    for (const record of candidates) {
      const err = validateRecord(record);
      if (err) {
        setLocalError(err);
        return;
      }
    }
    await onSave(candidates);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-main">
            Zone: <span className="font-mono text-primary">{zoneName}</span>
          </h1>
          <div className="mt-1 text-xs text-text-muted">
            Edit DNS records for this zone.
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div className="rounded-[var(--radius-card)] border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
          {success}
        </div>
      ) : null}

      {localError ? (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-text-main">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{localError}</span>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm text-text-muted">
          <thead className="table-header">
            <tr>
              <th className="px-4 py-3 w-48">Name</th>
              <th className="px-4 py-3 w-32">Type</th>
              <th className="px-4 py-3 w-24">TTL</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.map((record, index) => (
              <tr key={index} className="table-row">
                <td className="px-4 py-2">
                  <Input
                    value={record.name}
                    onChange={(e) => updateRecord(index, { name: e.target.value })}
                    className="h-9 font-mono"
                    placeholder="@"
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={record.type}
                    onChange={(e) =>
                      updateRecord(index, { type: e.target.value as DnsRecordType })
                    }
                    className="input-field h-9"
                  >
                    {recordTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    value={record.ttl ?? 300}
                    onChange={(e) =>
                      updateRecord(index, {
                        ttl: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    className="h-9 font-mono text-right"
                    min={0}
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    value={record.data}
                    onChange={(e) => updateRecord(index, { data: e.target.value })}
                    className="h-9 font-mono"
                    placeholder="1.2.3.4"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRecord(index)}
                    aria-label="Delete record"
                  >
                    <Trash2 className="h-4 w-4 text-text-muted" />
                  </Button>
                </td>
              </tr>
            ))}

            <tr>
              <td colSpan={5} className="px-4 py-3 bg-surface">
                <Button variant="secondary" size="sm" onClick={addRecord}>
                  <Plus className="h-4 w-4" />
                  Add Record
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

