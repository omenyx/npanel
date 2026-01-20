"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { RecordEditor } from "@/features/domains/components/record-editor";
import { getZone } from "@/features/domains/api";
import type { DnsRecord } from "@/features/domains/types";
import { requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
} from "@/shared/ui/governed-action-dialog";

export function AdminZoneEditScreen() {
  const params = useParams();
  const raw = typeof params?.zone === "string" ? params.zone : "";
  const zoneName = decodeURIComponent(raw);

  const [records, setRecords] = React.useState<DnsRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [actionDialogOpen, setActionDialogOpen] = React.useState(false);
  const [actionConfirmation, setActionConfirmation] =
    React.useState<GovernedConfirmation | null>(null);

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
      const confirmation = await requestJson<GovernedConfirmation>(
        `/v1/dns/zones/${encodeURIComponent(zoneName)}/prepare-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: next }),
        },
      );
      setActionConfirmation(confirmation);
      setActionDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <GovernedActionDialog
        open={actionDialogOpen}
        title="Confirm DNS Zone Update"
        confirmation={actionConfirmation}
        onClose={() => {
          setActionDialogOpen(false);
          setActionConfirmation(null);
        }}
        onConfirm={async (intentId, token) => {
          const res = await requestJson<any>(
            `/v1/dns/zones/${encodeURIComponent(zoneName)}/confirm-update`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId, token }),
            },
          );
          if (res?.status === "SUCCESS") {
            setSuccess("Saved.");
            await refresh();
          }
          return res;
        }}
      />
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
    </>
  );
}
