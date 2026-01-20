"use client";

import { useEffect, useRef, useState } from "react";
import { Users, Play, Pause, Trash2, Plus } from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";
import { normalizeToolStatusList } from "@/shared/api/system-status";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
} from "@/shared/ui/governed-action-dialog";

type Customer = {
  id: string;
  name: string;
  email: string;
  status: string;
};

type HostingService = {
  id: string;
  customerId: string;
  primaryDomain: string;
  planName: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type HostingPlan = {
  name: string;
};

type HostingLogEntry = {
  id: string;
  serviceId: string;
  adapter: string;
  operation: string;
  targetKind: string;
  targetKey: string;
  success: boolean;
  dryRun: boolean;
  details: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
};

export function AdminAccountsScreen() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<HostingService[]>([]);
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toolWarning, setToolWarning] = useState<string | null>(null);
  const pendingTerminations = services.filter((s) => s.status === "soft_deleted");

  const [showWizard, setShowWizard] = useState(false);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [newServiceCustomerId, setNewServiceCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newServiceDomain, setNewServiceDomain] = useState("");
  const [newServicePlan, setNewServicePlan] = useState("");
  const [wizardStep, setWizardStep] = useState(1);
  const [provisionLogs, setProvisionLogs] = useState<HostingLogEntry[]>([]);
  const [provisionServiceId, setProvisionServiceId] = useState<string | null>(null);

  const logPollTimerRef = useRef<number | null>(null);
  const seenLogIdsRef = useRef<Set<string>>(new Set());

  const [serviceActionId, setServiceActionId] = useState<string | null>(null);
  const [serviceActionLabel, setServiceActionLabel] = useState<string | null>(null);

  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateServiceId, setTerminateServiceId] = useState<string | null>(null);
  const [terminateToken, setTerminateToken] = useState<string | null>(null);
  const [terminateExpiresAt, setTerminateExpiresAt] = useState<number | null>(null);
  const [terminateRemaining, setTerminateRemaining] = useState<number>(0);

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsServiceId, setDetailsServiceId] = useState<string | null>(null);
  const [settingCredentials, setSettingCredentials] = useState(false);

  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogTitle, setActionDialogTitle] = useState<string>("");
  const [actionConfirmation, setActionConfirmation] =
    useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = useState<
    ((intentId: string, token: string) => Promise<any>) | null
  >(null);

  useEffect(() => {
    let timer: any;
    if (terminateExpiresAt) {
      const tick = () => {
        const now = Date.now();
        const remaining = Math.max(
          0,
          Math.floor((terminateExpiresAt - now) / 1000),
        );
        setTerminateRemaining(remaining);
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [terminateExpiresAt]);

  const refreshSingleService = async (id: string) => {
    const token = getAccessToken();
    if (!token) return;
    const updated = await requestJson<HostingService>(`/v1/hosting/services/${id}`);
    setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  useEffect(() => {
    const fetchData = async () => {
      const token = getAccessToken();
      if (!token) return;

      try {
        const [customersData, servicesData, plansData, toolsData] = await Promise.all([
          requestJson<Customer[]>("/v1/customers"),
          requestJson<HostingService[]>("/v1/hosting/services"),
          requestJson<HostingPlan[]>("/v1/hosting/plans"),
          requestJson<any>("/system/tools/status"),
        ]);

        setCustomers(customersData);
        setServices(servicesData);
        setPlans(plansData);
        if (plansData.length > 0) {
          setNewServicePlan((prev) => prev || plansData[0].name);
        }
        const toolList = normalizeToolStatusList(toolsData?.tools);
        if (toolList.length > 0) {
          const critical = ["useradd", "nginx", "php-fpm", "mysql", "mail_cmd", "ftp_cmd"];
          const missing = toolList
            .filter((t) => critical.includes(t.name) && !t.available)
            .map((t) => t.name);
          if (missing.length > 0) {
            setToolWarning(`Provisioning requires: ${missing.join(", ")} to be available.`);
          }
        }
      } catch {
        setError("Failed to load data");
      }
    };
    fetchData();
  }, []);

  const [creationCredentials, setCreationCredentials] = useState<any | null>(null);

  const stopLogPolling = () => {
    if (logPollTimerRef.current != null) {
      window.clearInterval(logPollTimerRef.current);
      logPollTimerRef.current = null;
    }
  };

  const startLogPolling = (serviceId: string) => {
    stopLogPolling();
    setProvisionLogs([]);
    seenLogIdsRef.current = new Set();
    const fetchOnce = async () => {
      try {
        const entries = await requestJson<HostingLogEntry[]>(
          `/v1/hosting/services/${serviceId}/logs`,
        );
        const asc = [...entries].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const next: HostingLogEntry[] = [];
        for (const e of asc) {
          if (!seenLogIdsRef.current.has(e.id)) {
            seenLogIdsRef.current.add(e.id);
            next.push(e);
          }
        }
        if (next.length > 0) {
          setProvisionLogs((prev) => [...prev, ...next]);
        }
      } catch {
        return;
      }
    };
    fetchOnce();
    logPollTimerRef.current = window.setInterval(fetchOnce, 1000);
  };

  useEffect(() => {
    return () => stopLogPolling();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWizardStep(2);
    setCreationCredentials(null);
    const token = getAccessToken();
    if (!token) return;

    try {
      const dto = {
        primaryDomain: newServiceDomain,
        planName: newServicePlan,
        autoProvision: true,
        ...(customerMode === "existing"
          ? { customerId: newServiceCustomerId }
          : { customer: { name: newCustomerName, email: newCustomerEmail } }),
      };
      const confirmation = await requestJson<any>("/v1/hosting/services/prepare-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dto),
      });
      setActionDialogTitle("Confirm Account Create + Provision");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<any>("/v1/hosting/services/confirm-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        const payload = res?.result;
        const createdService = payload?.service ?? payload;
        if (createdService?.id) {
          setServices((prev) => [createdService, ...prev.filter((s) => s.id !== createdService.id)]);
        }
        if (payload?.credentials && createdService?.id) {
          setCreationCredentials(payload);
          setDetailsServiceId(createdService.id);
          setShowDetailsModal(true);
        }
        setShowWizard(false);
        setNewServiceDomain("");
        setNewServiceCustomerId("");
        setProvisionServiceId(null);
        setWizardStep(1);
        return res;
      });
      setActionDialogOpen(true);
    } catch (err) {
      stopLogPolling();
      setError(err instanceof Error ? err.message : "Failed to create account");
      setWizardStep(1);
      setProvisionServiceId(null);
    }
  };

  const withServiceAction =
    (id: string, label: string, endpoint: string) => async () => {
      setError(null);
      setServiceActionId(id);
      setServiceActionLabel(label);
      try {
        const preparePath = `/v1/hosting/services/${id}/prepare-${endpoint}`;
        const confirmPath = `/v1/hosting/services/${id}/confirm-${endpoint}`;
        const confirmation = await requestJson<any>(preparePath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setActionDialogTitle(`Confirm ${label}`);
        setActionConfirmation(confirmation);
        setConfirmFn(() => async (intentId: string, confirmToken: string) => {
          const res = await requestJson<any>(confirmPath, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intentId, token: confirmToken }),
          });
          await refreshSingleService(id);
          return res;
        });
        setActionDialogOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setServiceActionId(null);
        setServiceActionLabel(null);
      }
    };

  const openDetails = (id: string) => {
    setDetailsServiceId(id);
    setShowDetailsModal(true);
  };

  const buildDetailsText = (svc: HostingService) => {
    const customer = customers.find((c) => c.id === svc.customerId);
    const username = `u_${(svc.primaryDomain.toLowerCase().split(".")[0] || "site")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "site"}`;
    const lines = [
      `Account Details`,
      `Domain: ${svc.primaryDomain}`,
      `Customer: ${customer ? `${customer.name} (${customer.email})` : svc.customerId}`,
      `Plan: ${svc.planName || "basic"}`,
      `Status: ${svc.status}`,
      "",
      `Access`,
      `Web Root: /home/${username}/public_html`,
      `System User: ${username}`,
      `FTP: host=${svc.primaryDomain}, user=${username} (password set by operator)`,
      `Mail: SMTP host=${svc.primaryDomain} ports=25,587; IMAP ports=143,993; postmaster@${svc.primaryDomain}`,
      `MySQL: user=${username}_db${creationCredentials?.credentials?.mysqlPassword ? `, password=${creationCredentials.credentials.mysqlPassword}` : " (password set by operator)"}`,
      "",
      `Notes`,
      `- Share passwords separately. Operator can set/reset initial credentials.`,
      `- DNS records: A/MX/TXT/SPF created by provisioning (verify as needed).`,
    ];
    return lines.join("\n");
  };

  const openTerminateFlow = async (id: string) => {
    setError(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      const payload = await requestJson<any>(
        `/v1/hosting/services/${id}/terminate/prepare`,
        { method: "POST" },
      );
      const expiresAt = payload?.service?.terminationTokenExpiresAt
        ? new Date(payload.service.terminationTokenExpiresAt).getTime()
        : null;
      setTerminateServiceId(id);
      setTerminateToken(payload.token || null);
      setTerminateExpiresAt(expiresAt);
      setShowTerminateModal(true);
      await refreshSingleService(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prepare hard delete failed");
    }
  };

  const confirmTerminate = async () => {
    if (!terminateServiceId || !terminateToken) return;
    setError(null);
    try {
      const payload = await requestJson<any>(
        `/v1/hosting/services/${terminateServiceId}/terminate/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: terminateToken, purge: true }),
        },
      );
      setShowTerminateModal(false);
      setTerminateServiceId(null);
      setTerminateToken(null);
      setTerminateExpiresAt(null);
      setServices((prev) => prev.filter((s) => s.id !== terminateServiceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm hard delete failed");
    }
  };

  const getCustomerName = (id: string) => {
    const c = customers.find((c) => c.id === id);
    return c ? `${c.name} (${c.email})` : id;
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
          <Users className="h-6 w-6 text-primary" />
          Accounts
        </h1>
        <button onClick={() => setShowWizard(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          Create Account
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm">
          {error}
        </div>
      )}

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Create Account Wizard</h3>
              <button
                onClick={() => setShowWizard(false)}
                className="text-text-muted hover:text-text-main"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-6 space-y-4">
              <div className="flex gap-4 mb-2 text-sm">
                <button
                  type="button"
                  onClick={() => setCustomerMode("existing")}
                  className={`px-3 py-1 rounded-[var(--radius-card)] border text-xs transition-colors ${
                    customerMode === "existing"
                      ? "border-primary text-primary bg-primary/5"
                      : "border-border text-text-muted"
                  }`}
                >
                  Existing Customer
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerMode("new")}
                  className={`px-3 py-1 rounded-[var(--radius-card)] border text-xs transition-colors ${
                    customerMode === "new"
                      ? "border-primary text-primary bg-primary/5"
                      : "border-border text-text-muted"
                  }`}
                >
                  New Customer
                </button>
              </div>
              <div>
                {customerMode === "existing" ? (
                  <>
                    <label className="label-text">Customer</label>
                    <select
                      value={newServiceCustomerId}
                      onChange={(e) => setNewServiceCustomerId(e.target.value)}
                      className="input-field"
                      required
                      disabled={wizardStep > 1}
                    >
                      <option value="">Select Customer...</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="label-text">Customer Name</label>
                      <input
                        type="text"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="input-field"
                        required
                        disabled={wizardStep > 1}
                      />
                    </div>
                    <div>
                      <label className="label-text">Customer Email</label>
                      <input
                        type="email"
                        value={newCustomerEmail}
                        onChange={(e) => setNewCustomerEmail(e.target.value)}
                        className="input-field"
                        required
                        disabled={wizardStep > 1}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="label-text">Primary Domain</label>
                <input
                  type="text"
                  placeholder="example.com"
                  value={newServiceDomain}
                  onChange={(e) => setNewServiceDomain(e.target.value)}
                  className="input-field"
                  required
                  disabled={wizardStep > 1}
                />
              </div>

              <div>
                <label className="label-text">Package</label>
                <select
                  value={newServicePlan}
                  onChange={(e) => setNewServicePlan(e.target.value)}
                  className="input-field"
                  required
                  disabled={wizardStep > 1}
                >
                  <option value="">Select Package...</option>
                  {plans.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {toolWarning && (
                <div className="text-[11px] text-warning bg-warning/10 border border-warning/20 rounded px-3 py-2">
                  {toolWarning}
                </div>
              )}

              {wizardStep === 2 && (
                <div className="rounded-[var(--radius-card)] border border-border bg-black/20 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Provisioning Activity
                  </div>
                  <div className="mt-2 max-h-56 overflow-y-auto space-y-2 pr-1">
                    {provisionLogs.length === 0 ? (
                      <div className="text-xs text-text-muted">Waiting for activity...</div>
                    ) : (
                      provisionLogs.map((l) => (
                        <div
                          key={l.id}
                          className="rounded border border-border bg-surface/40 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-mono text-text-main">
                              {l.adapter}:{l.operation} {l.targetKind} {l.targetKey}
                            </div>
                            <div
                              className={`text-[10px] font-semibold uppercase ${
                                l.success ? "text-success" : "text-danger"
                              }`}
                            >
                              {l.success ? "OK" : "FAIL"}
                            </div>
                          </div>
                          {l.errorMessage && (
                            <div className="mt-1 text-danger/90 font-mono">{l.errorMessage}</div>
                          )}
                          {l.details && (
                            <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-text-muted font-mono">
                              {JSON.stringify(l.details, null, 2)}
                            </pre>
                          )}
                          <div className="mt-1 text-[10px] text-text-muted">
                            {new Date(l.createdAt).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {provisionServiceId && (
                    <div className="mt-2 text-[10px] text-text-muted font-mono">
                      Service ID: {provisionServiceId}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowWizard(false)}
                  className="btn-secondary"
                  disabled={wizardStep > 1}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    wizardStep > 1 ||
                    (customerMode === "existing"
                      ? !newServiceCustomerId
                      : !newCustomerName || !newCustomerEmail)
                  }
                  className="btn-primary"
                >
                  {wizardStep === 2 ? "Provisioning..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingTerminations.length > 0 && (
        <div className="bg-warning/10 border border-warning/20 text-warning px-4 py-3 rounded-[var(--radius-card)]">
          {pendingTerminations.length === 1 ? (
            <span>
              Soft deleted: {pendingTerminations[0].primaryDomain}. Data preserved until retention expires.
            </span>
          ) : (
            <span>
              Soft deleted: {pendingTerminations.length} accounts. Data preserved until retention expires.
            </span>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-text-muted">
            <thead className="table-header">
              <tr>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">User / Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {services.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                    No accounts found.
                  </td>
                </tr>
              ) : (
                services.map((s) => {
                  const isBusy = serviceActionId === s.id;
                  return (
                    <tr key={s.id} className="table-row">
                      <td className="px-4 py-3 font-medium text-text-main">{s.primaryDomain}</td>
                      <td className="px-4 py-3">
                        <div className="text-text-main">{getCustomerName(s.customerId)}</div>
                        <div className="text-xs text-text-muted">{s.planName || "basic"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                            isBusy
                              ? "bg-surface text-text-muted animate-pulse"
                              : s.status === "active"
                                ? "bg-success/10 text-success"
                                : s.status === "suspended"
                                  ? "bg-warning/10 text-warning"
                                  : s.status === "provisioning"
                                    ? "bg-primary/10 text-primary"
                                    : s.status === "soft_deleted"
                                      ? "bg-warning/10 text-warning"
                                      : s.status === "terminated"
                                        ? "bg-danger/10 text-danger"
                                      : "bg-surface-hover text-text-muted"
                          }`}
                        >
                          {isBusy ? serviceActionLabel : s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {(s.status === "provisioning" || s.status === "error") && (
                            <button
                              onClick={withServiceAction(s.id, "Provisioning", "provision")}
                              disabled={isBusy}
                              className="p-1.5 text-primary hover:bg-primary/10 rounded disabled:opacity-50"
                              title="Provision"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}
                          {s.status === "active" && (
                            <button
                              onClick={withServiceAction(s.id, "Suspending", "suspend")}
                              disabled={isBusy}
                              className="p-1.5 text-warning hover:bg-warning/10 rounded disabled:opacity-50"
                              title="Suspend"
                            >
                              <Pause className="h-4 w-4" />
                            </button>
                          )}
                          {s.status === "suspended" && (
                            <button
                              onClick={withServiceAction(s.id, "Unsuspending", "unsuspend")}
                              disabled={isBusy}
                              className="p-1.5 text-success hover:bg-success/10 rounded disabled:opacity-50"
                              title="Unsuspend"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}
                          {s.status === "active" && (
                            <button
                              onClick={withServiceAction(s.id, "Soft deleting", "soft-delete")}
                              disabled={isBusy}
                              className="p-1.5 text-danger hover:bg-danger/10 rounded disabled:opacity-50"
                              title="Soft Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          {s.status === "soft_deleted" && (
                            <>
                              <button
                                onClick={withServiceAction(s.id, "Restoring", "restore")}
                                disabled={isBusy}
                                className="p-1.5 text-success hover:bg-success/10 rounded disabled:opacity-50"
                                title="Restore"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => openTerminateFlow(s.id)}
                                disabled={isBusy}
                                className="p-1.5 text-danger hover:bg-danger/10 rounded disabled:opacity-50"
                                title="Hard Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => openDetails(s.id)}
                            disabled={isBusy}
                            className="p-1.5 text-text-muted hover:bg-surface-hover rounded disabled:opacity-50"
                            title="Account Details"
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTerminateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Confirm Hard Delete</h3>
              <button
                onClick={() => setShowTerminateModal(false)}
                className="text-text-muted hover:text-text-main"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded p-3">
                This will permanently delete the hosting account and data after a final backup snapshot.
              </div>
              <div className="text-sm text-text-muted">
                Token: <span className="font-mono text-text-main">{terminateToken}</span>
              </div>
              <div className="text-xs text-text-muted">
                {terminateExpiresAt ? (
                  terminateRemaining > 0 ? (
                    `Token expires in ${Math.floor(terminateRemaining / 60)}m ${terminateRemaining % 60}s`
                  ) : (
                    "Token expired"
                  )
                ) : (
                  "No expiry provided"
                )}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowTerminateModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmTerminate}
                  disabled={terminateRemaining <= 0}
                  className="bg-danger hover:bg-danger-hover text-white px-4 py-2 rounded-[var(--radius-card)] text-sm font-medium disabled:opacity-50"
                >
                  Confirm Hard Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDetailsModal && detailsServiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Account Details</h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="text-text-muted hover:text-text-main"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              {(() => {
                const svc = services.find((s) => s.id === detailsServiceId);
                const text = svc ? buildDetailsText(svc) : "";
                return (
                  <>
                    <pre className="bg-surface-hover border border-border rounded p-3 text-xs text-text-main whitespace-pre-wrap">
                      {text}
                    </pre>
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        disabled={settingCredentials}
                        onClick={async () => {
                          if (!svc) return;
                          setSettingCredentials(true);
                          setError(null);
                          try {
                            const token = getAccessToken();
                            if (!token) return;
                            const payload = await requestJson<any>(
                              `/v1/hosting/services/${svc.id}/credentials/init`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({}),
                              },
                            );
                            setCreationCredentials({
                              credentials: {
                                mysqlPassword: creationCredentials?.credentials?.mysqlPassword,
                                mailboxPassword: payload.mailboxPassword,
                                ftpPassword: payload.ftpPassword,
                              },
                            });
                          } catch (e) {
                            setError("Failed to set credentials");
                          } finally {
                            setSettingCredentials(false);
                          }
                        }}
                        className="btn-primary"
                      >
                        {settingCredentials ? "Setting..." : "Set Initial Credentials"}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(text)}
                        className="btn-secondary"
                      >
                        Copy
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
