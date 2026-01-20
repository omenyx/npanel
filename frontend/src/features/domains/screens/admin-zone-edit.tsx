"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { RecordEditor } from "@/features/domains/components/record-editor";
import { getZone, updateZone } from "@/features/domains/api";
import type { DnsRecord } from "@/features/domains/types";

export function AdminZoneEditScreen() {
  const params = useParams();
  const raw = typeof params?.zone === "string" ? params.zone : "";
  const zoneName = decodeURIComponent(raw);

  const [records, setRecords] = React.useState<DnsRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getZone(zoneName);
      setRecords(data.records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zone.");
    } finally {
      setLoading(false);
    }
  }, [zoneName]);

  React.useEffect(() => {
    if (!zoneName) return;
    refresh();
  }, [zoneName, refresh]);

  const save = async (next: DnsRecord[]) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateZone(zoneName, { records: next });
      setSuccess("Saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordEditor
      zoneName={zoneName}
      records={records}
      loading={loading}
      saving={saving}
      error={error}
      success={success}
      onRefresh={refresh}
      onChangeRecords={setRecords}
      onSave={save}
    />
  );
}

