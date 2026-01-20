"use client";

import * as React from "react";
import { Globe, Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ZoneCreateDialog } from "@/features/domains/components/zone-create-dialog";
import { ZoneTable } from "@/features/domains/components/zone-table";
import { createZone, deleteZone, listZones } from "@/features/domains/api";
import type { DnsZoneName } from "@/features/domains/types";

export function AdminZoneListScreen() {
  const [zones, setZones] = React.useState<DnsZoneName[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<DnsZoneName | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

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
    const ok = confirm(`Delete zone "${zone}"? This cannot be undone.`);
    if (!ok) return;
    setDeleting(zone);
    setError(null);
    try {
      await deleteZone(zone);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete zone.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
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
          await createZone(input);
          await refresh();
        }}
      />
    </div>
  );
}

