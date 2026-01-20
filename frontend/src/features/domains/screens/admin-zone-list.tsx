"use client";

import * as React from "react";
import { Globe, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ZoneCreateDialog } from "@/features/domains/components/zone-create-dialog";
import { ZoneTable } from "@/features/domains/components/zone-table";
import { listZones } from "@/features/domains/api";
import type { DnsZoneName } from "@/features/domains/types";
import { requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
} from "@/shared/ui/governed-action-dialog";

export function AdminZoneListScreen() {
  const [zones, setZones] = React.useState<DnsZoneName[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<DnsZoneName | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const [actionDialogOpen, setActionDialogOpen] = React.useState(false);
  const [actionDialogTitle, setActionDialogTitle] = React.useState("");
  const [actionConfirmation, setActionConfirmation] =
    React.useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = React.useState<
    ((intentId: string, token: string) => Promise<any>) | null
  >(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listZones();
      setZones(data.zones);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load zones.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDelete = async (zone: DnsZoneName) => {
    setDeleting(zone);
    setError(null);
    try {
      const confirmation = await requestJson<GovernedConfirmation>(
        `/v1/dns/zones/${encodeURIComponent(zone)}/prepare-delete`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      setActionDialogTitle("Confirm DNS Zone Delete");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<any>(
          `/v1/dns/zones/${encodeURIComponent(zone)}/confirm-delete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId, token: confirmToken }),
          },
        );
        if (res?.status === "SUCCESS") {
          await refresh();
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete zone.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <GovernedActionDialog
        open={actionDialogOpen}
        title={actionDialogTitle}
        confirmation={actionConfirmation}
        onClose={() => {
          setActionDialogOpen(false);
          setActionConfirmation(null);
          setConfirmFn(null);
        }}
        onConfirm={async (intentId, confirmToken) => {
          if (!confirmFn) throw new Error("No confirm handler");
          return confirmFn(intentId, confirmToken);
        }}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          Domains
        </h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Zone
        </Button>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <ZoneTable
        zones={zones}
        loading={loading}
        deletingZone={deleting}
        onRefresh={refresh}
        onDelete={handleDelete}
      />

      <ZoneCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          const confirmation = await requestJson<GovernedConfirmation>(
            `/v1/dns/zones/prepare-create`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            },
          );
          setActionDialogTitle("Confirm DNS Zone Create");
          setActionConfirmation(confirmation);
          setConfirmFn(() => async (intentId: string, confirmToken: string) => {
            const res = await requestJson<any>(`/v1/dns/zones/confirm-create`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId, token: confirmToken }),
            });
            if (res?.status === "SUCCESS") {
              await refresh();
              setCreateOpen(false);
            }
            return res;
          });
          setActionDialogOpen(true);
        }}
      />
    </div>
  );
}
