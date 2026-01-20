"use client";

import { useEffect, useState, useRef } from "react";
import {
  ArrowRightLeft,
  Plus,
  RefreshCw,
  X,
  Play,
  ShieldAlert,
  Eye,
  Terminal,
} from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
  type GovernedResult,
} from "@/shared/ui/governed-action-dialog";

type MigrationJob = {
  id: string;
  name: string;
  status: string;
  sourceType: string;
  dryRun: boolean;
};

type MigrationStep = {
  id: string;
  name: string;
  status: string;
  lastError: { message: string } | null;
};

type MigrationLog = {
  id: string;
  level: string;
  message: string;
  createdAt: string;
};

export function AdminTransfersScreen() {
  const [transfers, setTransfers] = useState<MigrationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showWizard, setShowWizard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sshKey, setSshKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    sourceHost: "",
    sourcePort: 22,
    sourceUser: "root",
    authMethod: "system",
    sourcePassword: "",
    sourceKey: "",
    sourceUsername: "",
    sourceDomain: "",
    dryRun: true,
  });

  const [selectedJob, setSelectedJob] = useState<MigrationJob | null>(null);
  const [steps, setSteps] = useState<MigrationStep[]>([]);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogTitle, setActionDialogTitle] = useState("");
  const [actionConfirmation, setActionConfirmation] =
    useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = useState<
    ((intentId: string, token: string) => Promise<GovernedResult<any>>) | null
  >(null);

  const fetchData = async () => {
    setLoading(true);
    const token = getAccessToken();
    if (!token) return;

    try {
      const data = await requestJson<MigrationJob[]>("/v1/migrations");
      setTransfers(data);
    } catch (err) {
      setError("Failed to load transfers");
    } finally {
      setLoading(false);
    }
  };

  const fetchSshKey = async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const data = await requestJson<{ publicKey: string }>(
        "/system/tools/ssh-key",
      );
      setSshKey(data.publicKey);
    } catch (e) {
      setSshKey(null);
    }
  };

  const fetchJobDetails = async (jobId: string) => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [stepsData, logsData, updatedJob] = await Promise.all([
        requestJson<MigrationStep[]>(`/v1/migrations/${jobId}/steps`),
        requestJson<MigrationLog[]>(`/v1/migrations/${jobId}/logs`),
        requestJson<MigrationJob>(`/v1/migrations/${jobId}`),
      ]);
      setSteps(stepsData);
      setLogs(logsData);
      setSelectedJob(updatedJob);
      setTransfers((prev) => prev.map((t) => (t.id === updatedJob.id ? updatedJob : t)));
    } catch (e) {
      return;
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (showWizard) {
      fetchSshKey();
    }
  }, [showWizard]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (
      selectedJob &&
      (selectedJob.status === "running" || selectedJob.status === "pending")
    ) {
      fetchJobDetails(selectedJob.id);
      interval = setInterval(() => {
        fetchJobDetails(selectedJob.id);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [selectedJob?.id, selectedJob?.status]);

  const handleStartMigration = async () => {
    if (!selectedJob) return;
    setStarting(true);
    setError(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      const confirmation = await requestJson<GovernedConfirmation>(
        `/v1/migrations/${selectedJob.id}/start/prepare`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      setActionDialogTitle("Confirm Start Migration");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<GovernedResult<any>>(
          `/v1/migrations/${selectedJob.id}/start/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId, token: confirmToken }),
          },
        );
        if (res.status === "SUCCESS") {
          fetchJobDetails(selectedJob.id);
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (e) {
      setError("Failed to start migration");
    } finally {
      setStarting(false);
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    const token = getAccessToken();
    if (!token) return;

    try {
      const createConfirmation = await requestJson<GovernedConfirmation>("/v1/migrations/prepare-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          sourceType: "cpanel_live_ssh",
          sourceConfig: {
            host: formData.sourceHost,
            sshUser: formData.sourceUser,
            sshPort: Number(formData.sourcePort),
            sshPassword:
              formData.authMethod === "password"
                ? formData.sourcePassword
                : undefined,
            sshKey: formData.authMethod === "key" ? formData.sourceKey : undefined,
          },
          dryRun: formData.dryRun,
        }),
      });
      setActionDialogTitle("Confirm Transfer Job Create");
      setActionConfirmation(createConfirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const created = await requestJson<GovernedResult<any>>("/v1/migrations/confirm-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        if (created.status !== "SUCCESS") return created;
        const jobId = created.result?.id as string | undefined;
        if (!jobId) return created;

        const addAccountConfirmation = await requestJson<GovernedConfirmation>(
          `/v1/migrations/${jobId}/accounts/prepare-add`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceUsername: formData.sourceUsername,
              sourcePrimaryDomain: formData.sourceDomain,
            }),
          },
        );
        setActionDialogTitle("Confirm Transfer Account Add");
        setActionConfirmation(addAccountConfirmation);
        setConfirmFn(() => async (intentId2: string, confirmToken2: string) => {
          const added = await requestJson<GovernedResult<any>>(
            `/v1/migrations/${jobId}/accounts/confirm-add`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: intentId2, token: confirmToken2 }),
            },
          );
          if (added.status === "SUCCESS") {
            setShowWizard(false);
            setFormData({
              name: "",
              sourceHost: "",
              sourcePort: 22,
              sourceUser: "root",
              authMethod: "system",
              sourcePassword: "",
              sourceKey: "",
              sourceUsername: "",
              sourceDomain: "",
              dryRun: true,
            });
            fetchData();
          }
          return added;
        });
        return created;
      });
      setActionDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create transfer");
    } finally {
      setCreating(false);
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
        onConfirm={async (intentId, token) => {
          if (!confirmFn) throw new Error("No confirm handler");
          return confirmFn(intentId, token);
        }}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-primary" />
          Transfers
        </h1>
        <div className="flex gap-2">
          <button onClick={fetchData} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setShowWizard(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            New Transfer
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          {error}
        </div>
      )}

      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-surface-hover">
              <div>
                <h3 className="font-semibold text-text-main flex items-center gap-2">
                  {selectedJob.name}
                  <span
                    className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                      selectedJob.status === "completed"
                        ? "bg-success/10 text-success border-success/20"
                        : selectedJob.status === "failed"
                          ? "bg-danger/10 text-danger border-danger/20"
                          : selectedJob.status === "running"
                            ? "bg-primary/10 text-primary border-primary/20 animate-pulse"
                            : "bg-surface text-text-muted border-border"
                    }`}
                  >
                    {selectedJob.status}
                  </span>
                </h3>
                <div className="text-xs text-text-muted font-mono mt-1">
                  {selectedJob.id}
                </div>
              </div>
              <div className="flex gap-3">
                {selectedJob.status === "pending" && (
                  <button
                    onClick={handleStartMigration}
                    disabled={starting}
                    className="flex items-center gap-2 btn-primary text-xs py-1.5"
                  >
                    {starting ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {starting ? "Starting..." : "Start Migration"}
                  </button>
                )}
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-text-muted hover:text-text-main"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              <div className="w-full md:w-1/3 border-r border-border overflow-y-auto bg-surface">
                <div className="p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                    Migration Steps
                  </h4>
                  {steps.length === 0 ? (
                    <div className="text-xs text-text-muted italic text-center py-4">
                      Steps will be generated when started.
                    </div>
                  ) : (
                    steps.map((step) => (
                      <div
                        key={step.id}
                        className={`p-3 rounded-[var(--radius-card)] border text-xs ${
                          step.status === "running"
                            ? "bg-primary/5 border-primary/20 text-primary"
                            : step.status === "completed"
                              ? "bg-success/5 border-success/20 text-success"
                              : step.status === "failed"
                                ? "bg-danger/5 border-danger/20 text-danger"
                                : "bg-surface-hover border-border text-text-muted"
                        }`}
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-medium">{step.name}</span>
                          {step.status === "running" && (
                            <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                          )}
                        </div>
                        {step.lastError && (
                          <div className="mt-1 text-danger break-words bg-danger/5 p-1.5 rounded">
                            {step.lastError.message}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex-1 bg-black text-white overflow-y-auto font-mono text-xs p-4">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Terminal className="h-3 w-3" />
                  Execution Logs
                </h4>
                <div className="space-y-1">
                  {logs.map((log) => (
                    <div key={log.id} className="flex gap-2">
                      <span className="text-zinc-600 shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                      <span
                        className={`${
                          log.level === "error"
                            ? "text-red-400"
                            : log.level === "warning"
                              ? "text-amber-400"
                              : "text-zinc-300"
                        } break-all`}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-zinc-700 italic">
                      No logs available yet...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">New Transfer Job</h3>
              <button
                onClick={() => setShowWizard(false)}
                className="text-text-muted hover:text-text-main"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateTransfer} className="p-6 space-y-4">
              <div className="space-y-4">
                <h4 className="text-xs uppercase text-primary font-semibold tracking-wider">
                  Source Connection
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-text">Job Name</label>
                    <input
                      type="text"
                      placeholder="Migration Job 1"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="label-text">Source Host (IP)</label>
                    <input
                      type="text"
                      placeholder="192.168.1.100"
                      value={formData.sourceHost}
                      onChange={(e) =>
                        setFormData({ ...formData, sourceHost: e.target.value })
                      }
                      className="input-field"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-text">SSH User</label>
                    <input
                      type="text"
                      placeholder="root"
                      value={formData.sourceUser}
                      onChange={(e) =>
                        setFormData({ ...formData, sourceUser: e.target.value })
                      }
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="label-text">SSH Port</label>
                    <input
                      type="number"
                      placeholder="22"
                      value={formData.sourcePort}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          sourcePort: parseInt(e.target.value) || 22,
                        })
                      }
                      className="input-field"
                    />
                  </div>
                </div>

                <div>
                  <label className="label-text mb-2">Authentication Method</label>
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer select-none">
                      <input
                        type="radio"
                        name="authMethod"
                        value="system"
                        checked={formData.authMethod === "system"}
                        onChange={() =>
                          setFormData({ ...formData, authMethod: "system" })
                        }
                        className="bg-surface border-border text-primary focus:ring-primary"
                      />
                      System Key
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer select-none">
                      <input
                        type="radio"
                        name="authMethod"
                        value="password"
                        checked={formData.authMethod === "password"}
                        onChange={() =>
                          setFormData({ ...formData, authMethod: "password" })
                        }
                        className="bg-surface border-border text-primary focus:ring-primary"
                      />
                      Password
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-main cursor-pointer select-none">
                      <input
                        type="radio"
                        name="authMethod"
                        value="key"
                        checked={formData.authMethod === "key"}
                        onChange={() =>
                          setFormData({ ...formData, authMethod: "key" })
                        }
                        className="bg-surface border-border text-primary focus:ring-primary"
                      />
                      Private Key
                    </label>
                  </div>

                  {formData.authMethod === "system" && (
                    <p className="text-[10px] text-text-muted">
                      Ensure local SSH key is authorized on source host for this user.
                    </p>
                  )}

                  {formData.authMethod === "password" && (
                    <div className="mt-2">
                      <label className="label-text">SSH Password</label>
                      <input
                        type="password"
                        value={formData.sourcePassword}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sourcePassword: e.target.value,
                          })
                        }
                        className="input-field"
                        placeholder="Password"
                      />
                    </div>
                  )}

                  {formData.authMethod === "key" && (
                    <div className="mt-2">
                      <label className="label-text">Private Key</label>
                      <textarea
                        value={formData.sourceKey}
                        onChange={(e) =>
                          setFormData({ ...formData, sourceKey: e.target.value })
                        }
                        className="input-field font-mono text-xs h-32"
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      />
                    </div>
                  )}
                </div>
              </div>

              {sshKey && formData.authMethod === "system" && (
                <div className="bg-surface border border-border rounded p-3 mt-4">
                  <label className="block text-[10px] uppercase text-text-muted mb-1 font-semibold">
                    System Public Key
                  </label>
                  <p className="text-[10px] text-text-muted mb-2">
                    Copy and append this key to{" "}
                    <code className="text-text-main">/root/.ssh/authorized_keys</code>{" "}
                    on the source server.
                  </p>
                  <div className="flex gap-2">
                    <code className="flex-1 bg-surface-hover p-2 rounded text-[10px] text-text-muted font-mono break-all max-h-20 overflow-y-auto border border-border">
                      {sshKey}
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(sshKey)}
                      className="btn-secondary text-xs h-fit self-start"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-border my-4"></div>

              <div className="space-y-4">
                <h4 className="text-xs uppercase text-success font-semibold tracking-wider">
                  Account to Migrate
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-text">Source Username</label>
                    <input
                      type="text"
                      placeholder="cpaneluser"
                      value={formData.sourceUsername}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          sourceUsername: e.target.value,
                        })
                      }
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="label-text">Primary Domain</label>
                    <input
                      type="text"
                      placeholder="example.com"
                      value={formData.sourceDomain}
                      onChange={(e) =>
                        setFormData({ ...formData, sourceDomain: e.target.value })
                      }
                      className="input-field"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="dryRun"
                  checked={formData.dryRun}
                  onChange={(e) =>
                    setFormData({ ...formData, dryRun: e.target.checked })
                  }
                  className="rounded border-border bg-surface text-primary focus:ring-primary"
                />
                <label htmlFor="dryRun" className="text-sm text-text-main select-none">
                  Dry Run (Test connection & rsync without modifying target)
                </label>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-border mt-4">
                <button
                  type="button"
                  onClick={() => setShowWizard(false)}
                  className="btn-secondary"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="btn-primary">
                  {creating ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Create Job
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {transfers.length === 0 ? (
        <div className="text-center py-12 text-text-muted bg-surface/50 rounded-lg border border-border border-dashed">
          No active or past transfers found. Click \"New Transfer\" to start.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-sm text-text-muted">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3">Job Name</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.map((t) => (
                <tr key={t.id} className="table-row">
                  <td className="px-4 py-3 font-medium text-text-main">
                    {t.name}
                    <div className="text-[10px] text-text-muted font-mono">
                      {t.id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t.sourceType === "cpanel_live_ssh" ? "Live SSH" : t.sourceType}
                  </td>
                  <td className="px-4 py-3">
                    {t.dryRun ? (
                      <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded border border-warning/20">
                        Dry Run
                      </span>
                    ) : (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
                        Live
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 uppercase text-xs">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                        t.status === "completed"
                          ? "bg-success/10 text-success"
                          : t.status === "failed"
                            ? "bg-danger/10 text-danger"
                            : t.status === "running"
                              ? "bg-primary/10 text-primary animate-pulse"
                              : "bg-surface-hover text-text-muted"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setSelectedJob(t);
                        fetchJobDetails(t.id);
                      }}
                      className="btn-secondary text-xs px-2 py-1 h-auto inline-flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
