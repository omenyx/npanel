"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Server,
  Play,
  RefreshCcw,
  ListChecks,
  ScrollText,
  AlertTriangle,
} from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
  type GovernedResult,
} from "@/shared/ui/governed-action-dialog";

type HostingService = {
  id: string;
  primaryDomain: string;
  status: string;
};

type MigrationJob = {
  id: string;
  name: string;
  status: string;
  sourceType: string;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
};

type MigrationStep = {
  id: string;
  name: string;
  status: string;
  lastError: { message: string } | null;
  createdAt: string;
  updatedAt: string;
};

type MigrationLog = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
  accountId: string | null;
};

export default function CustomerMigrationsPage() {
  const [services, setServices] = useState<HostingService[]>([]);
  const [jobs, setJobs] = useState<MigrationJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [steps, setSteps] = useState<MigrationStep[]>([]);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogTitle, setActionDialogTitle] = useState("");
  const [actionConfirmation, setActionConfirmation] =
    useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = useState<
    ((intentId: string, token: string) => Promise<GovernedResult<any>>) | null
  >(null);

  const [targetServiceId, setTargetServiceId] = useState<string>("");
  const [sourceHost, setSourceHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sourceUsername, setSourceUsername] = useState("");
  const [sourcePrimaryDomain, setSourcePrimaryDomain] = useState("");

  const selectedService = useMemo(
    () => services.find((s) => s.id === targetServiceId) || null,
    [services, targetServiceId],
  );

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getAccessToken();
        if (!token) return;
        const [servicesData, jobsData] = await Promise.all([
          requestJson<HostingService[]>("/v1/customer/hosting/services"),
          requestJson<MigrationJob[]>("/v1/customer/migrations"),
        ]);
        setServices(servicesData);
        setJobs(jobsData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  useEffect(() => {
    if (!selectedService) return;
    setSourcePrimaryDomain(selectedService.primaryDomain);
  }, [selectedService]);

  const refreshJobDetails = async (jobId: string) => {
    const token = getAccessToken();
    if (!token) return;
    const [stepsData, logsData] = await Promise.all([
      requestJson<MigrationStep[]>(`/v1/customer/migrations/${jobId}/steps`),
      requestJson<MigrationLog[]>(`/v1/customer/migrations/${jobId}/logs`),
    ]);
    setSteps(stepsData);
    setLogs(logsData);
  };

  const startMigration = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!targetServiceId) throw new Error("Select a service");
      if (!sourceHost.trim()) throw new Error("Enter source host");
      if (!sshUser.trim()) throw new Error("Enter SSH user");
      if (!sourceUsername.trim()) throw new Error("Enter cPanel username");
      if (!sourcePrimaryDomain.trim()) throw new Error("Enter primary domain");

      const token = getAccessToken();
      if (!token) return;

      const createConfirmation = await requestJson<GovernedConfirmation>("/v1/customer/migrations/prepare-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${sourcePrimaryDomain} transfer`,
          sourceType: "cpanel_live_ssh",
          sourceConfig: {
            host: sourceHost.trim(),
            sshUser: sshUser.trim(),
            sshPort: Number.parseInt(sshPort, 10) || 22,
          },
          dryRun: false,
        }),
      });
      setActionDialogTitle("Confirm Transfer Job Create");
      setActionConfirmation(createConfirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const created = await requestJson<GovernedResult<any>>("/v1/customer/migrations/confirm-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        if (created.status !== "SUCCESS") return created;
        const jobId = created.result?.id as string | undefined;
        if (!jobId) return created;

        const addAccountConfirmation = await requestJson<GovernedConfirmation>(
          `/v1/customer/migrations/${jobId}/accounts/prepare-add`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceUsername: sourceUsername.trim(),
              sourcePrimaryDomain: sourcePrimaryDomain.trim(),
              targetServiceId,
            }),
          },
        );
        setActionDialogTitle("Confirm Transfer Account Add");
        setActionConfirmation(addAccountConfirmation);
        setConfirmFn(() => async (intentId2: string, confirmToken2: string) => {
          const added = await requestJson<GovernedResult<any>>(
            `/v1/customer/migrations/${jobId}/accounts/confirm-add`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intentId: intentId2, token: confirmToken2 }),
            },
          );
          if (added.status !== "SUCCESS") return added;

          const planConfirmation = await requestJson<GovernedConfirmation>(
            `/v1/customer/migrations/${jobId}/plan/prepare`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            },
          );
          setActionDialogTitle("Confirm Transfer Plan");
          setActionConfirmation(planConfirmation);
          setConfirmFn(() => async (intentId3: string, confirmToken3: string) => {
            const planned = await requestJson<GovernedResult<any>>(
              `/v1/customer/migrations/${jobId}/plan/confirm`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ intentId: intentId3, token: confirmToken3 }),
              },
            );
            if (planned.status === "SUCCESS") {
              const jobsData = await requestJson<MigrationJob[]>("/v1/customer/migrations");
              setJobs(jobsData);
              setActiveJobId(jobId);
              await refreshJobDetails(jobId);
            }
            return planned;
          });
          return added;
        });
        return created;
      });
      setActionDialogOpen(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runNext = async () => {
    if (!activeJobId) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const confirmation = await requestJson<GovernedConfirmation>(
        `/v1/customer/migrations/${activeJobId}/run-next/prepare`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      setActionDialogTitle("Confirm Run Next Step");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<GovernedResult<any>>(
          `/v1/customer/migrations/${activeJobId}/run-next/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId, token: confirmToken }),
          },
        );
        if (res.status === "SUCCESS") {
          await refreshJobDetails(activeJobId);
          const jobsData = await requestJson<MigrationJob[]>("/v1/customer/migrations");
          setJobs(jobsData);
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="text-zinc-400">Loading transfers...</div>;
  }

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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800">
          <ArrowRightLeft className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Transfers</h1>
          <p className="text-sm text-zinc-400">
            Move your primary domain from cPanel/WHM using a secure SSH transfer.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-2 text-lg font-medium text-white">
          <Server className="h-5 w-5 text-zinc-400" />
          Start a Transfer
        </div>

        <div className="mb-4 rounded-md border border-amber-900/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>
              This imports your primary domain only. Mailboxes are recreated with new passwords. Plan limits are enforced.
            </div>
          </div>
        </div>

        <form onSubmit={startMigration} className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Target Service
            </label>
            <select
              value={targetServiceId}
              onChange={(e) => setTargetServiceId(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              required
            >
              <option value="" disabled>
                Select a service
              </option>
              {services.map((svc) => (
                <option key={svc.id} value={svc.id}>
                  {svc.primaryDomain} ({svc.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Primary Domain
            </label>
            <input
              value={sourcePrimaryDomain}
              onChange={(e) => setSourcePrimaryDomain(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Source Host
            </label>
            <input
              value={sourceHost}
              onChange={(e) => setSourceHost(e.target.value)}
              placeholder="cpanel.example.com"
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                SSH User
              </label>
              <input
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="root"
                className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                SSH Port
              </label>
              <input
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              cPanel Username
            </label>
            <input
              value={sourceUsername}
              onChange={(e) => setSourceUsername(e.target.value)}
              placeholder="example"
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              required
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Starting..." : "Start Transfer"}
            </button>
          </div>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-medium text-white">
              <ListChecks className="h-5 w-5 text-zinc-400" />
              Jobs
            </div>
            <button
              onClick={async () => {
                setBusy(true);
                try {
                  const token = getAccessToken();
                  if (!token) return;
                  const jobsData = await requestJson<MigrationJob[]>("/v1/customer/migrations");
                  setJobs(jobsData);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white disabled:opacity-50"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="text-sm text-zinc-500">No transfers yet.</div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={async () => {
                    setActiveJobId(job.id);
                    await refreshJobDetails(job.id);
                  }}
                  className={`w-full rounded-md border px-4 py-3 text-left transition-colors ${
                    activeJobId === job.id
                      ? "border-indigo-600/60 bg-indigo-900/10"
                      : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{job.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                      {job.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-medium text-white">
              <ScrollText className="h-5 w-5 text-zinc-400" />
              Progress
            </div>
            <button
              onClick={runNext}
              disabled={busy || !activeJobId}
              className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Run Next Step
            </button>
          </div>

          {!activeJobId ? (
            <div className="text-sm text-zinc-500">Select a job to view progress.</div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-md border border-zinc-800 bg-zinc-950 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-white">{step.name}</div>
                      <span className="rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
                        {step.status}
                      </span>
                    </div>
                    {step.lastError?.message && (
                      <div className="mt-2 text-xs text-red-300">
                        {step.lastError.message}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-zinc-800 bg-black p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
                  Latest Logs
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {logs.slice(0, 50).map((log) => (
                    <div key={log.id} className="text-xs text-zinc-300">
                      <span className="text-zinc-500">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>{" "}
                      <span
                        className={
                          log.level === "error"
                            ? "text-red-300"
                            : log.level === "warning"
                              ? "text-amber-200"
                              : "text-zinc-300"
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-xs text-zinc-500">No logs yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
