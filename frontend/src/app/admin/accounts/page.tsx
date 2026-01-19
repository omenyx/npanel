"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Play,
  Pause,
  Trash2,
  Plus,
} from "lucide-react";

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

export default function AccountsPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<HostingService[]>([]);
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toolWarning, setToolWarning] = useState<string | null>(null);
  const pendingTerminations = services.filter(s => s.status === 'termination_pending');

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [newServiceCustomerId, setNewServiceCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newServiceDomain, setNewServiceDomain] = useState("");
  const [newServicePlan, setNewServicePlan] = useState("");
  const [autoProvision, setAutoProvision] = useState(false);
  const [wizardStep, setWizardStep] = useState(1); // 1: Input, 2: Creating...

  // Actions
  const [serviceActionId, setServiceActionId] = useState<string | null>(null);
  const [serviceActionLabel, setServiceActionLabel] = useState<string | null>(null);

  // Termination modal state
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateServiceId, setTerminateServiceId] = useState<string | null>(null);
  const [terminateToken, setTerminateToken] = useState<string | null>(null);
  const [terminateExpiresAt, setTerminateExpiresAt] = useState<number | null>(null);
  const [terminateRemaining, setTerminateRemaining] = useState<number>(0);
// Details View State
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsServiceId, setDetailsServiceId] = useState<string | null>(null);
  const [settingCredentials, setSettingCredentials] = useState(false);

  useEffect(() => {
    let timer: any;
    if (terminateExpiresAt) {
      const tick = () => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((terminateExpiresAt - now) / 1000));
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
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;
    const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const updated = await res.json();
      setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const token = window.localStorage.getItem("npanel_access_token");
      if (!token) return;

      try {
        const [customersRes, servicesRes, plansRes, toolsRes] = await Promise.all([
          fetch("http://127.0.0.1:3000/v1/customers", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("http://127.0.0.1:3000/v1/hosting/services", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("http://127.0.0.1:3000/v1/hosting/plans", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("http://127.0.0.1:3000/system/tools/status"),
        ]);

        if (customersRes.ok) setCustomers(await customersRes.json());
        if (servicesRes.ok) setServices(await servicesRes.json());
        if (plansRes.ok) {
          const plansData = await plansRes.json();
          setPlans(plansData);
          if (plansData.length > 0) {
              setNewServicePlan((prev) => prev || plansData[0].name);
          }
        }
        if (toolsRes.ok) {
          const tools = await toolsRes.json();
          const critical = ["useradd", "nginx", "php-fpm", "mysql"]; // mail/ftp checked backend
          const missing = tools.filter((t: any) => critical.includes(t.name) && !t.available).map((t: any) => t.name);
          if (missing.length > 0) {
            setToolWarning(`Auto-provision requires: ${missing.join(", ")} to be available.`);
          }
        }
      } catch {
        setError("Failed to load data");
      }
    };
    fetchData();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWizardStep(2);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      // 1. Create Service
      const res = await fetch("http://127.0.0.1:3000/v1/hosting/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          primaryDomain: newServiceDomain,
          planName: newServicePlan,
          autoProvision,
          ...(customerMode === "existing"
            ? { customerId: newServiceCustomerId }
            : { customer: { name: newCustomerName, email: newCustomerEmail } }),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to create service");
      }

      const payload = await res.json();
      const newService = payload?.service ?? payload;
      setServices((prev) => [newService, ...prev]);
      if (payload?.credentials) {
        setCreationCredentials(payload);
        setDetailsServiceId(newService.id);
        setShowDetailsModal(true);
      }

      // 2. Auto Provision if checked
      if (autoProvision) {
        await fetch(`http://127.0.0.1:3000/v1/hosting/services/${newService.id}/provision`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        });
        // Refresh to get updated status
        await refreshSingleService(newService.id);
      }

      setShowWizard(false);
      setNewServiceDomain("");
      setNewServiceCustomerId("");
      setWizardStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
      setWizardStep(1);
    }
  };

  const withServiceAction = (id: string, label: string, endpoint: string) => async () => {
    setError(null);
    setServiceActionId(id);
    setServiceActionLabel(label);
    const token = window.localStorage.getItem("npanel_access_token");
    try {
        const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${id}/${endpoint}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${label} failed`);
        await refreshSingleService(id);
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

  const [creationCredentials, setCreationCredentials] = useState<any | null>(null);

  const buildDetailsText = (svc: HostingService) => {
    const customer = customers.find(c => c.id === svc.customerId);
    const username = `u_${(svc.primaryDomain.toLowerCase().split('.')[0] || 'site').replace(/[^a-z0-9]/g, '').slice(0, 8) || 'site'}`;
    const lines = [
      `Account Details`,
      `Domain: ${svc.primaryDomain}`,
      `Customer: ${customer ? `${customer.name} (${customer.email})` : svc.customerId}`,
      `Plan: ${svc.planName || 'basic'}`,
      `Status: ${svc.status}`,
      '',
      `Access`,
      `Web Root: /home/${username}/public_html`,
      `System User: ${username}`,
      `FTP: host=${svc.primaryDomain}, user=${username} (password set by operator)`,
      `Mail: SMTP host=${svc.primaryDomain} ports=25,587; IMAP ports=143,993; postmaster@${svc.primaryDomain}`,
      `MySQL: user=${username}_db${creationCredentials?.credentials?.mysqlPassword ? `, password=${creationCredentials.credentials.mysqlPassword}` : ' (password set by operator)'}`,
      '',
      `Notes`,
      `- Share passwords separately. Operator can set/reset initial credentials.`,
      `- DNS records: A/MX/TXT/SPF created by provisioning (verify as needed).`,
    ];
    return lines.join('\n');
  };

  const openTerminateFlow = async (id: string) => {
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${id}/terminate/prepare`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || "Prepare termination failed");
      }
      const expiresAt = payload?.service?.terminationTokenExpiresAt ? new Date(payload.service.terminationTokenExpiresAt).getTime() : null;
      setTerminateServiceId(id);
      setTerminateToken(payload.token || null);
      setTerminateExpiresAt(expiresAt);
      setShowTerminateModal(true);
      await refreshSingleService(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prepare termination failed");
    }
  };

  const confirmTerminate = async () => {
    if (!terminateServiceId || !terminateToken) return;
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${terminateServiceId}/terminate/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: terminateToken }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || "Confirm termination failed");
      }
      setShowTerminateModal(false);
      setTerminateServiceId(null);
      setTerminateToken(null);
      setTerminateExpiresAt(null);
      await refreshSingleService(payload.id || terminateServiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm termination failed");
    }
  };

  const cancelTerminate = async (id: string) => {
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${id}/terminate/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.message || "Cancel termination failed");
      }
      await refreshSingleService(id);
      if (terminateServiceId === id) {
        setShowTerminateModal(false);
        setTerminateServiceId(null);
        setTerminateToken(null);
        setTerminateExpiresAt(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel termination failed");
    }
  };

  const getCustomerName = (id: string) => {
    const c = customers.find(c => c.id === id);
    return c ? `${c.name} (${c.email})` : id;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Accounts
        </h1>
        <button
          onClick={() => setShowWizard(true)}
          className="btn-primary"
        >
          <Plus className="h-4 w-4" />
          Create Account
        </button>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm">
          {error}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Create Account Wizard</h3>
              <button onClick={() => setShowWizard(false)} className="text-text-muted hover:text-text-main">✕</button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-6 space-y-4">
              <div className="flex gap-4 mb-2 text-sm">
                <button
                  type="button"
                  onClick={() => setCustomerMode("existing")}
                  className={`px-3 py-1 rounded-[var(--radius-card)] border text-xs transition-colors ${
                    customerMode === "existing" ? "border-primary text-primary bg-primary/5" : "border-border text-text-muted"
                  }`}
                >
                  Existing Customer
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerMode("new")}
                  className={`px-3 py-1 rounded-[var(--radius-card)] border text-xs transition-colors ${
                    customerMode === "new" ? "border-primary text-primary bg-primary/5" : "border-border text-text-muted"
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
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
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
                    {plans.map(p => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                    type="checkbox"
                    id="autoProvision"
                    checked={autoProvision}
                    onChange={(e) => setAutoProvision(e.target.checked)}
                    className="rounded border-border bg-surface text-primary focus:ring-primary"
                    disabled={wizardStep > 1}
                />
                <label htmlFor="autoProvision" className="text-sm text-text-main select-none">
                    Auto-provision after create
                </label>
              </div>

              {autoProvision && toolWarning && (
                <div className="text-[11px] text-warning bg-warning/10 border border-warning/20 rounded px-3 py-2">
                  {toolWarning}
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
                    disabled={wizardStep > 1 || (customerMode === "existing" ? !newServiceCustomerId : !newCustomerName || !newCustomerEmail)}
                    className="btn-primary"
                >
                    {wizardStep === 2 ? "Creating..." : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pending Terminations Banner */}
      {pendingTerminations.length > 0 && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-3 rounded-[var(--radius-card)]">
          {pendingTerminations.length === 1 ? (
            <span>Termination pending for {pendingTerminations[0].primaryDomain}. You may cancel before confirmation.</span>
          ) : (
            <span>Termination pending for {pendingTerminations.length} accounts. You may cancel before confirmation.</span>
          )}
        </div>
      )}

      {/* Accounts Table */}
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
                        services.map(s => {
                            const isBusy = serviceActionId === s.id;
                            return (
                                <tr key={s.id} className="table-row">
                                    <td className="px-4 py-3 font-medium text-text-main">
                                        {s.primaryDomain}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="text-text-main">{getCustomerName(s.customerId)}</div>
                                        <div className="text-xs text-text-muted">{s.planName || 'basic'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                                            isBusy ? 'bg-surface text-text-muted animate-pulse' :
                                            s.status === 'active' ? 'bg-success/10 text-success' :
                                            s.status === 'suspended' ? 'bg-warning/10 text-warning' :
                                            s.status === 'provisioning' ? 'bg-primary/10 text-primary' :
                                            s.status === 'termination_pending' ? 'bg-danger/10 text-danger' :
                                            'bg-surface-hover text-text-muted'
                                        }`}>
                                            {isBusy ? serviceActionLabel : s.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* Provision */}
                                            {(s.status === 'pending' || s.status === 'error') && (
                                                <button
                                                    onClick={withServiceAction(s.id, 'Provisioning', 'provision')}
                                                    disabled={isBusy}
                                                    className="p-1.5 text-primary hover:bg-primary/10 rounded disabled:opacity-50"
                                                    title="Provision"
                                                >
                                                    <Play className="h-4 w-4" />
                                                </button>
                                            )}
                                            {/* Suspend */}
                                            {s.status === 'active' && (
                                                <button
                                                    onClick={withServiceAction(s.id, 'Suspending', 'suspend')}
                                                    disabled={isBusy}
                                                    className="p-1.5 text-warning hover:bg-warning/10 rounded disabled:opacity-50"
                                                    title="Suspend"
                                                >
                                                    <Pause className="h-4 w-4" />
                                                </button>
                                            )}
                                            {/* Unsuspend */}
                                            {s.status === 'suspended' && (
                                                <button
                                                    onClick={withServiceAction(s.id, 'Unsuspending', 'unsuspend')}
                                                    disabled={isBusy}
                                                    className="p-1.5 text-success hover:bg-success/10 rounded disabled:opacity-50"
                                                    title="Unsuspend"
                                                >
                                                    <Play className="h-4 w-4" />
                                                </button>
                                            )}
                                            {/* Terminate (two-phase) */}
                                            {s.status !== 'termination_pending' && (
                                              <button
                                                onClick={() => openTerminateFlow(s.id)}
                                                disabled={isBusy}
                                                className="p-1.5 text-danger hover:bg-danger/10 rounded disabled:opacity-50"
                                                title="Terminate"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            )}
                                            {/* Details */}
                                            <button
                                              onClick={() => openDetails(s.id)}
                                              disabled={isBusy}
                                              className="p-1.5 text-text-muted hover:bg-surface-hover rounded disabled:opacity-50"
                                              title="Account Details"
                                            >
                                              Details
                                            </button>
                                            {/* Cancel termination when pending */}
                                            {s.status === 'termination_pending' && (
                                              <button
                                                onClick={() => cancelTerminate(s.id)}
                                                disabled={isBusy}
                                                className="p-1.5 text-warning hover:bg-warning/10 rounded disabled:opacity-50"
                                                title="Cancel Termination"
                                              >
                                                Cancel
                                              </button>
                                            )}
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

      {/* Termination Confirm Modal */}
      {showTerminateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Confirm Termination</h3>
              <button onClick={() => setShowTerminateModal(false)} className="text-text-muted hover:text-text-main">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded p-3">
                This will permanently delete the hosting account and data.
              </div>
              <div className="text-sm text-text-muted">
                Token: <span className="font-mono text-text-main">{terminateToken}</span>
              </div>
              <div className="text-xs text-text-muted">
                {terminateExpiresAt ? (
                  terminateRemaining > 0 ? `Token expires in ${Math.floor(terminateRemaining/60)}m ${terminateRemaining%60}s` : 'Token expired'
                ) : 'No expiry provided'}
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
                  Confirm Termination
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Details Modal */}
      {showDetailsModal && detailsServiceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h3 className="font-semibold text-text-main">Account Details</h3>
              <button onClick={() => setShowDetailsModal(false)} className="text-text-muted hover:text-text-main">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {(() => {
                const svc = services.find(s => s.id === detailsServiceId);
                const text = svc ? buildDetailsText(svc) : '';
                return (
                  <>
                    <pre className="bg-surface-hover border border-border rounded p-3 text-xs text-text-main whitespace-pre-wrap">{text}</pre>
                    <div className="flex justify-end gap-3">
                      <button
                          type="button"
                          disabled={settingCredentials}
                          onClick={async () => {
                            if (!svc) return;
                            setSettingCredentials(true);
                            setError(null);
                            const token = window.localStorage.getItem("npanel_access_token");
                            try {
                                const res = await fetch(`http://127.0.0.1:3000/v1/hosting/services/${svc.id}/credentials/init`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                                    body: JSON.stringify({}),
                                });
                                const payload = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                    setError(payload?.message || "Failed to set initial credentials");
                                    return;
                                }
                                setCreationCredentials({ credentials: { mysqlPassword: creationCredentials?.credentials?.mysqlPassword, mailboxPassword: payload.mailboxPassword, ftpPassword: payload.ftpPassword } });
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
