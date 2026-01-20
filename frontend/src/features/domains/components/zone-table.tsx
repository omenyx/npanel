"use client";

import Link from "next/link";
import { Edit, RefreshCw, Trash2 } from "lucide-react";
import type { DnsZoneName } from "@/features/domains/types";
import { Button } from "@/shared/ui/button";

type ZoneTableProps = {
  zones: DnsZoneName[];
  loading: boolean;
  deletingZone: DnsZoneName | null;
  onRefresh: () => void;
  onDelete: (zone: DnsZoneName) => void;
};

export function ZoneTable({
  zones,
  loading,
  deletingZone,
  onRefresh,
  onDelete,
}: ZoneTableProps) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="text-sm font-semibold text-text-main">Zones</div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      <table className="w-full text-left text-sm text-text-muted">
        <thead className="table-header">
          <tr>
            <th className="px-4 py-3">Zone Name</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {zones.map((zone) => (
            <tr key={zone} className="table-row">
              <td className="px-4 py-3 font-mono font-medium text-text-main">
                {zone}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/admin/dns/${encodeURIComponent(zone)}`}>
                      <Edit className="h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(zone)}
                    disabled={deletingZone === zone}
                  >
                    {deletingZone === zone ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}

          {!loading && zones.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-4 py-10 text-center text-text-muted">
                No DNS zones found.
              </td>
            </tr>
          ) : null}

          {loading && zones.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-4 py-10 text-center text-text-muted">
                <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                Loading zones…
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

