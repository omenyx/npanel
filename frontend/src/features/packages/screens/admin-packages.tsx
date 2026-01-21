"use client";

import { useEffect, useState } from "react";
import { Package, Plus, Trash2, AlertTriangle } from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
} from "@/shared/ui/governed-action-dialog";

type HostingPlan = {
  name: string;
  diskQuotaMb: number;
  maxDatabases: number;
  phpVersion: string;
  mailboxQuotaMb: number;
  maxMailboxes: number;
  maxFtpAccounts: number;
};

type HostingService = {
  id: string;
  planName: string | null;
};

export function AdminPackagesScreen() {
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [services, setServices] = useState<HostingService[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanDisk, setNewPlanDisk] = useState("1024");
  const [newPlanPhp, setNewPlanPhp] = useState("8.2");
  const [newPlanMaxDbs, setNewPlanMaxDbs] = useState("1");
  const [newPlanMailboxQuota, setNewPlanMailboxQuota] = useState("1024");
  const [newPlanMaxMailboxes, setNewPlanMaxMailboxes] = useState("1");
  const [newPlanMaxFtp, setNewPlanMaxFtp] = useState("1");

  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogTitle, setActionDialogTitle] = useState<string>("");
  const [actionConfirmation, setActionConfirmation] =
    useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = useState<
    ((intentId: string, token: string) => Promise<any>) | null
  >(null);

  const fetchData = async () => {
    const token = getAccessToken();
    if (!token) return;

    try {
      const [plansData, servicesData] = await Promise.all([
        requestJson<HostingPlan[]>("/v1/hosting/plans"),
        requestJson<HostingService[]>("/v1/hosting/services"),
      ]);
      setPlans(plansData);
      setServices(servicesData);
    } catch {
      setError("Failed to load data");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    const token = getAccessToken();
    if (!token) return;

    try {
      const disk = parseInt(newPlanDisk, 10);
      const maxDbs = parseInt(newPlanMaxDbs, 10);
      const mailboxQuota = parseInt(newPlanMailboxQuota, 10);
      const maxMailboxes = parseInt(newPlanMaxMailboxes, 10);
      const maxFtp = parseInt(newPlanMaxFtp, 10);

      if (
        isNaN(disk) ||
        isNaN(maxDbs) ||
        isNaN(mailboxQuota) ||
        isNaN(maxMailboxes) ||
        isNaN(maxFtp)
      ) {
        throw new Error("Invalid numeric values");
      }

      const payload = {
        name: newPlanName,
        diskQuotaMb: disk,
        phpVersion: newPlanPhp,
        maxDatabases: maxDbs,
        mailboxQuotaMb: mailboxQuota,
        maxMailboxes: maxMailboxes,
        maxFtpAccounts: maxFtp,
      };

      const confirmation = await requestJson<GovernedConfirmation>(
        "/v1/hosting/plans/prepare-create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setActionDialogTitle("Confirm Package Create");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<any>("/v1/hosting/plans/confirm-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        const created = res?.result;
        if (created?.name) {
          setPlans((prev) =>
            [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
          );
          setShowCreate(false);
          setNewPlanName("");
          setNewPlanDisk("1024");
          setNewPlanMaxDbs("1");
          setNewPlanMailboxQuota("1024");
          setNewPlanMaxMailboxes("1");
          setNewPlanMaxFtp("1");
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    } finally {
      setCreating(false);
    }
  };

  const getUsageCount = (planName: string) => {
    return services.filter((s) => (s.planName || "basic") === planName).length;
  };

  const formatLimit = (val: number, unit?: string) => {
    if (val === -1) return "Unlimited";
    if (val === 0 && unit === "MB") return "Unlimited";
    return unit ? `${val} ${unit}` : val;
  };

  const handleDelete = async (planName: string) => {
    const usage = getUsageCount(planName);
    if (usage > 0) {
      setError(
        `Cannot delete package "${planName}" because it is used by ${usage} account(s). Reassign those account(s) first.`,
      );
      return;
    }
    setDeleting(planName);
    setError(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      const confirmation = await requestJson<GovernedConfirmation>(
        `/v1/hosting/plans/${encodeURIComponent(planName)}/prepare-delete`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      setActionDialogTitle("Confirm Package Delete");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<any>(
          `/v1/hosting/plans/${encodeURIComponent(planName)}/confirm-delete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId, token: confirmToken }),
          },
        );
        if (res?.status === "SUCCESS") {
          setPlans((prev) => prev.filter((p) => p.name !== planName));
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete package");
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
          <Package className="h-6 w-6 text-primary" />
          Packages
        </h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Package
        </button>
      </div>

      {error && !showCreate && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {showCreate && (
        <div className="card p-6 mb-6">
          <h3 className="text-lg font-semibold text-text-main mb-4">
            New Package
          </h3>
          {error && (
            <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}
          <form onSubmit={handleCreatePlan} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label-text">Package Name</label>
                <input
                  type="text"
                  placeholder="e.g. basic, pro, enterprise"
                  value={newPlanName}
                  onChange={(e) => setNewPlanName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="label-text">Disk Quota (MB)</label>
                <input
                  type="number"
                  min="0"
                  value={newPlanDisk}
                  onChange={(e) => setNewPlanDisk(e.target.value)}
                  className="input-field"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Set to 0 for unlimited
                </p>
              </div>

              <div>
                <label className="label-text">PHP Version</label>
                <select
                  value={newPlanPhp}
                  onChange={(e) => setNewPlanPhp(e.target.value)}
                  className="input-field"
                  required
                >
                  <option value="7.4">7.4</option>
                  <option value="8.0">8.0</option>
                  <option value="8.1">8.1</option>
                  <option value="8.2">8.2</option>
                  <option value="8.3">8.3</option>
                </select>
              </div>

              <div>
                <label className="label-text">Max Databases</label>
                <input
                  type="number"
                  min="-1"
                  value={newPlanMaxDbs}
                  onChange={(e) => setNewPlanMaxDbs(e.target.value)}
                  className="input-field"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Set to -1 for unlimited
                </p>
              </div>

              <div>
                <label className="label-text">Max FTP Accounts</label>
                <input
                  type="number"
                  min="-1"
                  value={newPlanMaxFtp}
                  onChange={(e) => setNewPlanMaxFtp(e.target.value)}
                  className="input-field"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Set to -1 for unlimited
                </p>
              </div>

              <div>
                <label className="label-text">Mailbox Quota (MB)</label>
                <input
                  type="number"
                  min="0"
                  value={newPlanMailboxQuota}
                  onChange={(e) => setNewPlanMailboxQuota(e.target.value)}
                  className="input-field"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Set to 0 for unlimited
                </p>
              </div>

              <div>
                <label className="label-text">Max Mailboxes</label>
                <input
                  type="number"
                  min="-1"
                  value={newPlanMaxMailboxes}
                  onChange={(e) => setNewPlanMaxMailboxes(e.target.value)}
                  className="input-field"
                  required
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Set to -1 for unlimited
                </p>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn-primary"
              >
                {creating && (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                )}
                {creating ? "Creating..." : "Create Package"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
          const usageCount = getUsageCount(p.name);
          return (
            <div key={p.name} className="card p-5 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-text-main text-lg">{p.name}</h3>
                  {usageCount > 0 ? (
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                      {usageCount} accounts
                    </span>
                  ) : (
                    <span className="text-[10px] bg-surface-hover text-text-muted px-2 py-0.5 rounded-full border border-border">
                      Unused
                    </span>
                  )}
                </div>
                <div className="space-y-1 text-sm text-text-muted">
                  <div className="flex justify-between">
                    <span>Disk:</span>{" "}
                    <span className="text-text-main">
                      {formatLimit(p.diskQuotaMb, "MB")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>PHP:</span>{" "}
                    <span className="text-text-main">{p.phpVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>DBs:</span>{" "}
                    <span className="text-text-main">
                      {formatLimit(p.maxDatabases)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Mail:</span>{" "}
                    <span className="text-text-main">
                      {formatLimit(p.maxMailboxes)} ({p.mailboxQuotaMb} MB)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>FTP:</span>{" "}
                    <span className="text-text-main">
                      {formatLimit(p.maxFtpAccounts)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-end">
                <button
                  onClick={() => handleDelete(p.name)}
                  disabled={deleting === p.name}
                  className="text-text-muted hover:text-danger transition-colors p-1 disabled:opacity-50"
                  title="Delete Package"
                >
                  {deleting === p.name ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-danger/20 border-t-danger" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
