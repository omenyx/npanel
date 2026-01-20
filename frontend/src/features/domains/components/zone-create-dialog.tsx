"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { DnsRecord, DnsZoneName } from "@/features/domains/types";
import { normalizeZoneName, validateZoneName } from "@/features/domains/validators";

type ZoneCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { zoneName: DnsZoneName; records: DnsRecord[] }) => Promise<void>;
};

export function ZoneCreateDialog({ open, onOpenChange, onCreate }: ZoneCreateDialogProps) {
  const [zoneName, setZoneName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setZoneName("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalized = normalizeZoneName(zoneName);
    const validation = validateZoneName(normalized);
    if (validation) {
      setError(validation);
      return;
    }

    setSubmitting(true);
    try {
      const records: DnsRecord[] = [
        {
          name: "@",
          type: "SOA",
          data: `ns1.${normalized}. hostmaster.${normalized}. 1 3600 900 1209600 300`,
        },
        { name: "@", type: "NS", data: `ns1.${normalized}.` },
        { name: "ns1", type: "A", data: "127.0.0.1" },
      ];
      await onCreate({ zoneName: normalized, records });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create zone.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Zone</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="label-text">Zone Name</label>
            <Input
              placeholder="example.com"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              autoFocus
            />
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !zoneName.trim()}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

