"use client";

import { useEffect, useState } from "react";
import { Package, Plus, Trash2, AlertTriangle } from "lucide-react";

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

export default function PackagesPage() {
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [services, setServices] = useState<HostingService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create State
  const [showCreate, setShowCreate] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newPlanDisk, setNewPlanDisk] = useState("1024");
  const [newPlanPhp, setNewPlanPhp] = useState("8.2");
  const [newPlanMaxDbs, setNewPlanMaxDbs] = useState("1");
  const [newPlanMailboxQuota, setNewPlanMailboxQuota] = useState("1024");
  const [newPlanMaxMailboxes, setNewPlanMaxMailboxes] = useState("1");
  const [newPlanMaxFtp, setNewPlanMaxFtp] = useState("1");

  const fetchData = async () => {
    setLoading(true);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const [plansRes, servicesRes] = await Promise.all([
        fetch("http://127.0.0.1:3000/v1/hosting/plans", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("http://127.0.0.1:3000/v1/hosting/services", { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (plansRes.ok) setPlans(await plansRes.json());
      if (servicesRes.ok) setServices(await servicesRes.json());
    } catch (err) {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const res = await fetch("http://127.0.0.1:3000/v1/hosting/plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newPlanName,
          diskQuotaMb: parseInt(newPlanDisk, 10),
          phpVersion: newPlanPhp,
          maxDatabases: parseInt(newPlanMaxDbs, 10),
          mailboxQuotaMb: parseInt(newPlanMailboxQuota, 10),
          maxMailboxes: parseInt(newPlanMaxMailboxes, 10),
          maxFtpAccounts: parseInt(newPlanMaxFtp, 10),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || "Failed to create plan");
      }

      const newPlan = await res.json();
      setPlans((prev) => [...prev, newPlan].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      // Reset form
      setNewPlanName("");
      setNewPlanDisk("1024");
      setNewPlanMaxDbs("1");
      setNewPlanMailboxQuota("1024");
      setNewPlanMaxMailboxes("1");
      setNewPlanMaxFtp("1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    }
  };

  const getUsageCount = (planName: string) => {
    return services.filter(s => (s.planName || 'basic') === planName).length;
  };

  const formatLimit = (val: number, unit?: string) => {
    if (val === -1) return "Unlimited";
    if (val === 0 && unit === "MB") return "Unlimited";
    return unit ? `${val} ${unit}` : val;
  };

  const handleDelete = async (planName: string) => {
    const usage = getUsageCount(planName);
    if (usage > 0) {
      alert(`Cannot delete package "${planName}" because it is used by ${usage} account(s).\n\nNext steps: Reassign those account(s) to another package, then retry deletion.`);
      return;
    }
    if (!confirm(`Delete package "${planName}"? This cannot be undone.`)) {
      return;
    }
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/hosting/plans/${encodeURIComponent(planName)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to delete package");
      }
      setPlans(prev => prev.filter(p => p.name !== planName));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete package");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Package className="h-6 w-6 text-blue-500" />
          Packages
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Package
        </button>
      </div>

      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">New Package</h3>
            <form onSubmit={handleCreatePlan} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Package Name</label>
                    <input
                      type="text"
                      placeholder="e.g. basic, pro, enterprise"
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Disk Quota (MB)</label>
                    <input
                      type="number"
                      min="0"
                      value={newPlanDisk}
                      onChange={(e) => setNewPlanDisk(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Set to 0 for unlimited</p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">PHP Version</label>
                    <select
                      value={newPlanPhp}
                      onChange={(e) => setNewPlanPhp(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    >
                      {['7.4', '8.0', '8.1', '8.2', '8.3'].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Max Databases</label>
                    <input
                      type="number"
                      min="-1"
                      value={newPlanMaxDbs}
                      onChange={(e) => setNewPlanMaxDbs(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Set to -1 for unlimited</p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Max FTP Accounts</label>
                    <input
                      type="number"
                      min="-1"
                      value={newPlanMaxFtp}
                      onChange={(e) => setNewPlanMaxFtp(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Set to -1 for unlimited</p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Mailbox Quota (MB)</label>
                    <input
                      type="number"
                      min="0"
                      value={newPlanMailboxQuota}
                      onChange={(e) => setNewPlanMailboxQuota(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Set to 0 for unlimited</p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Max Mailboxes</label>
                    <input
                      type="number"
                      min="-1"
                      value={newPlanMaxMailboxes}
                      onChange={(e) => setNewPlanMaxMailboxes(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      required
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Set to -1 for unlimited</p>
                  </div>
                </div>

                <div className="flex gap-3 justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium"
                  >
                    Create Package
                  </button>
                </div>
            </form>
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => {
            const usageCount = getUsageCount(p.name);
            return (
                <div key={p.name} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 flex flex-col justify-between">
                    <div>
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="font-bold text-white text-lg">{p.name}</h3>
                            {usageCount > 0 ? (
                                <span className="text-[10px] bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-900/50">
                                    {usageCount} accounts
                                </span>
                            ) : (
                                <span className="text-[10px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full border border-zinc-700">
                                    Unused
                                </span>
                            )}
                        </div>
                        <div className="space-y-1 text-sm text-zinc-400">
                            <div className="flex justify-between"><span>Disk:</span> <span className="text-zinc-200">{formatLimit(p.diskQuotaMb, "MB")}</span></div>
                            <div className="flex justify-between"><span>PHP:</span> <span className="text-zinc-200">{p.phpVersion}</span></div>
                            <div className="flex justify-between"><span>DBs:</span> <span className="text-zinc-200">{formatLimit(p.maxDatabases)}</span></div>
                            <div className="flex justify-between"><span>Mail:</span> <span className="text-zinc-200">{formatLimit(p.maxMailboxes)} ({p.mailboxQuotaMb} MB)</span></div>
                            <div className="flex justify-between"><span>FTP:</span> <span className="text-zinc-200">{formatLimit(p.maxFtpAccounts)}</span></div>
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-end">
                        <button 
                            onClick={() => handleDelete(p.name)}
                            className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                            title="Delete Package"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            );
        })}
      </div>
    </div>
  );
}
