"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowRightLeft, Plus, RefreshCw, X, Play, ShieldAlert, Eye, Terminal } from "lucide-react";

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

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<MigrationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sshKey, setSshKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    sourceHost: "",
    sourcePort: 22,
    sourceUser: "root",
    authMethod: "system", // system, password, key
    sourcePassword: "",
    sourceKey: "",
    sourceUsername: "", // cPanel account user
    sourceDomain: "",   // cPanel account domain
    dryRun: true
  });

  // Details View State
  const [selectedJob, setSelectedJob] = useState<MigrationJob | null>(null);
  const [steps, setSteps] = useState<MigrationStep[]>([]);
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [polling, setPolling] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const res = await fetch("http://127.0.0.1:3000/v1/migrations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setTransfers(await res.json());
    } catch (err) {
      setError("Failed to load transfers");
    } finally {
      setLoading(false);
    }
  };

  const fetchSshKey = async () => {
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;
    try {
        const res = await fetch("http://127.0.0.1:3000/system/tools/ssh-key", {
             headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const data = await res.json();
            setSshKey(data.publicKey);
        }
    } catch (e) {
        console.error("Failed to fetch SSH key", e);
    }
  };

  const fetchJobDetails = async (jobId: string) => {
      const token = window.localStorage.getItem("npanel_access_token");
      if (!token) return;
      try {
          const [stepsRes, logsRes, jobRes] = await Promise.all([
              fetch(`http://127.0.0.1:3000/v1/migrations/${jobId}/steps`, { headers: { Authorization: `Bearer ${token}` } }),
              fetch(`http://127.0.0.1:3000/v1/migrations/${jobId}/logs`, { headers: { Authorization: `Bearer ${token}` } }),
              fetch(`http://127.0.0.1:3000/v1/migrations/${jobId}`, { headers: { Authorization: `Bearer ${token}` } })
          ]);
          if (stepsRes.ok) setSteps(await stepsRes.json());
          if (logsRes.ok) setLogs(await logsRes.json());
          if (jobRes.ok) {
              const updatedJob = await jobRes.json();
              setSelectedJob(updatedJob);
              // Update status in list as well
              setTransfers(prev => prev.map(t => t.id === updatedJob.id ? updatedJob : t));
          }
      } catch (e) {
          console.error("Failed to fetch job details", e);
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

  // Polling for details view
  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (selectedJob && (selectedJob.status === 'running' || selectedJob.status === 'pending')) {
          fetchJobDetails(selectedJob.id); // Immediate fetch
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
      const token = window.localStorage.getItem("npanel_access_token");
      if (!token) {
          setStarting(false);
          return;
      }
      try {
          await fetch(`http://127.0.0.1:3000/v1/migrations/${selectedJob.id}/start`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` }
          });
          // Refresh details immediately
          fetchJobDetails(selectedJob.id);
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

    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) {
        setCreating(false);
        return;
    }

    try {
        // 1. Create Job
        const jobRes = await fetch("http://127.0.0.1:3000/v1/migrations", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                name: formData.name,
                sourceType: "cpanel_live_ssh",
                sourceConfig: {
                    host: formData.sourceHost,
                    sshUser: formData.sourceUser,
                    sshPort: Number(formData.sourcePort),
                    sshPassword: formData.authMethod === 'password' ? formData.sourcePassword : undefined,
                    sshKey: formData.authMethod === 'key' ? formData.sourceKey : undefined
                },
                dryRun: formData.dryRun
            }),
        });

        if (!jobRes.ok) {
            const err = await jobRes.json();
            throw new Error(err.message || "Failed to create migration job");
        }

        const job = await jobRes.json();

        // 2. Add Account
        const accRes = await fetch(`http://127.0.0.1:3000/v1/migrations/${job.id}/accounts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                sourceUsername: formData.sourceUsername,
                sourcePrimaryDomain: formData.sourceDomain
            }),
        });

        if (!accRes.ok) {
            // If adding account fails, we still have the job, but warn user
            const err = await accRes.json();
            throw new Error(`Job created, but adding account failed: ${err.message}`);
        }

        // Success
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
            dryRun: true
        });
        fetchData();

    } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create transfer");
    } finally {
        setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-blue-500" />
          Transfers
        </h1>
        <div className="flex gap-2">
            <button
            onClick={fetchData}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 rounded text-sm transition-colors"
            >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
            >
            <Plus className="h-4 w-4" />
            New Transfer
            </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-2 rounded text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Details View Modal */}
      {selectedJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
                  <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
                      <div>
                          <h3 className="font-semibold text-white flex items-center gap-2">
                              {selectedJob.name}
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                                  selectedJob.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50' :
                                  selectedJob.status === 'failed' ? 'bg-red-900/30 text-red-400 border border-red-900/50' :
                                  selectedJob.status === 'running' ? 'bg-blue-900/30 text-blue-400 border border-blue-900/50 animate-pulse' :
                                  'bg-zinc-800 text-zinc-400'
                              }`}>
                                  {selectedJob.status}
                              </span>
                          </h3>
                          <div className="text-xs text-zinc-500 font-mono mt-1">{selectedJob.id}</div>
                      </div>
                      <div className="flex gap-3">
                        {selectedJob.status === 'pending' && (
                             <button 
                                onClick={handleStartMigration}
                                disabled={starting}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                             >
                                 {starting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                 {starting ? "Starting..." : "Start Migration"}
                             </button>
                        )}
                        <button onClick={() => setSelectedJob(null)} className="text-zinc-500 hover:text-white">
                            <X className="h-5 w-5" />
                        </button>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                      {/* Steps List */}
                      <div className="w-full md:w-1/3 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50">
                          <div className="p-4 space-y-2">
                              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Migration Steps</h4>
                              {steps.length === 0 ? (
                                  <div className="text-xs text-zinc-600 italic text-center py-4">
                                      Steps will be generated when started.
                                  </div>
                              ) : (
                                  steps.map(step => (
                                      <div key={step.id} className={`p-3 rounded border text-xs ${
                                          step.status === 'running' ? 'bg-blue-900/10 border-blue-900/30 text-blue-200' :
                                          step.status === 'completed' ? 'bg-emerald-900/10 border-emerald-900/30 text-emerald-200' :
                                          step.status === 'failed' ? 'bg-red-900/10 border-red-900/30 text-red-200' :
                                          'bg-zinc-950 border-zinc-800 text-zinc-400'
                                      }`}>
                                          <div className="flex justify-between items-center mb-1">
                                              <span className="font-medium">{step.name}</span>
                                              {step.status === 'running' && <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />}
                                          </div>
                                          {step.lastError && (
                                              <div className="mt-1 text-red-400 break-words bg-red-950/50 p-1.5 rounded">
                                                  {step.lastError.message}
                                              </div>
                                          )}
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>
                      
                      {/* Logs View */}
                      <div className="flex-1 bg-black overflow-y-auto font-mono text-xs p-4">
                          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                              <Terminal className="h-3 w-3" />
                              Execution Logs
                          </h4>
                          <div className="space-y-1">
                              {logs.map(log => (
                                  <div key={log.id} className="flex gap-2">
                                      <span className="text-zinc-600 shrink-0">
                                          {new Date(log.createdAt).toLocaleTimeString()}
                                      </span>
                                      <span className={`${
                                          log.level === 'error' ? 'text-red-400' :
                                          log.level === 'warning' ? 'text-amber-400' :
                                          'text-zinc-300'
                                      } break-all`}>
                                          {log.message}
                                      </span>
                                  </div>
                              ))}
                              {logs.length === 0 && (
                                  <div className="text-zinc-700 italic">No logs available yet...</div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Create Transfer Wizard */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="font-semibold text-white">New Transfer Job</h3>
              <button onClick={() => setShowWizard(false)} className="text-zinc-500 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateTransfer} className="p-6 space-y-4">
              
              {/* Job Details */}
              <div className="space-y-4">
                <h4 className="text-xs uppercase text-blue-400 font-semibold tracking-wider">Source Connection</h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">Job Name</label>
                        <input
                            type="text"
                            placeholder="Migration Job 1"
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">Source Host (IP)</label>
                        <input
                            type="text"
                            placeholder="192.168.1.100"
                            value={formData.sourceHost}
                            onChange={(e) => setFormData({...formData, sourceHost: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">SSH User</label>
                        <input
                            type="text"
                            placeholder="root"
                            value={formData.sourceUser}
                            onChange={(e) => setFormData({...formData, sourceUser: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">SSH Port</label>
                        <input
                            type="number"
                            placeholder="22"
                            value={formData.sourcePort}
                            onChange={(e) => setFormData({...formData, sourcePort: parseInt(e.target.value) || 22})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs uppercase text-zinc-500 mb-2">Authentication Method</label>
                    <div className="flex gap-4 mb-2">
                        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                            <input 
                                type="radio" 
                                name="authMethod"
                                value="system"
                                checked={formData.authMethod === 'system'}
                                onChange={() => setFormData({...formData, authMethod: 'system'})}
                                className="bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-blue-500"
                            />
                            System Key
                        </label>
                        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                            <input 
                                type="radio" 
                                name="authMethod"
                                value="password"
                                checked={formData.authMethod === 'password'}
                                onChange={() => setFormData({...formData, authMethod: 'password'})}
                                className="bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-blue-500"
                            />
                            Password
                        </label>
                        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                            <input 
                                type="radio" 
                                name="authMethod"
                                value="key"
                                checked={formData.authMethod === 'key'}
                                onChange={() => setFormData({...formData, authMethod: 'key'})}
                                className="bg-zinc-950 border-zinc-800 text-blue-600 focus:ring-blue-500"
                            />
                            Private Key
                        </label>
                    </div>

                    {formData.authMethod === 'system' && (
                        <p className="text-[10px] text-zinc-600">
                            Ensure local SSH key is authorized on source host for this user.
                        </p>
                    )}

                    {formData.authMethod === 'password' && (
                        <div className="mt-2">
                            <label className="block text-xs uppercase text-zinc-500 mb-1">SSH Password</label>
                            <input
                                type="password"
                                value={formData.sourcePassword}
                                onChange={(e) => setFormData({...formData, sourcePassword: e.target.value})}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                                placeholder="Password"
                            />
                        </div>
                    )}

                    {formData.authMethod === 'key' && (
                        <div className="mt-2">
                            <label className="block text-xs uppercase text-zinc-500 mb-1">Private Key</label>
                            <textarea
                                value={formData.sourceKey}
                                onChange={(e) => setFormData({...formData, sourceKey: e.target.value})}
                                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 font-mono text-xs h-32"
                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                            />
                        </div>
                    )}
                </div>
              </div>
              
              {sshKey && formData.authMethod === 'system' && (
                <div className="bg-zinc-950 border border-zinc-800 rounded p-3 mt-4">
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1 font-semibold">System Public Key</label>
                    <p className="text-[10px] text-zinc-500 mb-2">
                        Copy and append this key to <code className="text-zinc-400">/root/.ssh/authorized_keys</code> on the source server.
                    </p>
                    <div className="flex gap-2">
                        <code className="flex-1 bg-black/50 p-2 rounded text-[10px] text-zinc-400 font-mono break-all max-h-20 overflow-y-auto border border-zinc-900">
                            {sshKey}
                        </code>
                        <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(sshKey)}
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1 rounded text-xs transition-colors h-fit self-start"
                        >
                            Copy
                        </button>
                    </div>
                </div>
              )}

              <div className="border-t border-zinc-800 my-4"></div>

              {/* Account Details */}
              <div className="space-y-4">
                <h4 className="text-xs uppercase text-emerald-400 font-semibold tracking-wider">Account to Migrate</h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">Source Username</label>
                        <input
                            type="text"
                            placeholder="cpaneluser"
                            value={formData.sourceUsername}
                            onChange={(e) => setFormData({...formData, sourceUsername: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs uppercase text-zinc-500 mb-1">Primary Domain</label>
                        <input
                            type="text"
                            placeholder="example.com"
                            value={formData.sourceDomain}
                            onChange={(e) => setFormData({...formData, sourceDomain: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
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
                    onChange={(e) => setFormData({...formData, dryRun: e.target.checked})}
                    className="rounded border-zinc-800 bg-zinc-950 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="dryRun" className="text-sm text-zinc-300 select-none">
                    Dry Run (Test connection & rsync without modifying target)
                </label>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-zinc-800 mt-4">
                <button
                    type="button"
                    onClick={() => setShowWizard(false)}
                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                    disabled={creating}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={creating}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
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
        <div className="text-center py-12 text-zinc-500 bg-zinc-900/50 rounded-lg border border-zinc-800 border-dashed">
            No active or past transfers found. Click "New Transfer" to start.
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-left text-sm text-zinc-400">
                <thead className="bg-zinc-950 text-xs uppercase text-zinc-500 font-medium">
                    <tr>
                        <th className="px-4 py-3">Job Name</th>
                        <th className="px-4 py-3">Source</th>
                        <th className="px-4 py-3">Mode</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                    {transfers.map(t => (
                        <tr key={t.id} className="hover:bg-zinc-800/50">
                            <td className="px-4 py-3 font-medium text-zinc-200">
                                {t.name}
                                <div className="text-[10px] text-zinc-500 font-mono">{t.id}</div>
                            </td>
                            <td className="px-4 py-3">
                                {t.sourceType === 'cpanel_live_ssh' ? 'Live SSH' : t.sourceType}
                            </td>
                            <td className="px-4 py-3">
                                {t.dryRun ? (
                                    <span className="text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded border border-amber-900/50">Dry Run</span>
                                ) : (
                                    <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded border border-blue-900/50">Live</span>
                                )}
                            </td>
                            <td className="px-4 py-3 uppercase text-xs">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
                                    t.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' :
                                    t.status === 'failed' ? 'bg-red-900/30 text-red-400' :
                                    t.status === 'running' ? 'bg-blue-900/30 text-blue-400 animate-pulse' :
                                    'bg-zinc-800 text-zinc-400'
                                }`}>
                                    {t.status}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                                <button
                                    onClick={() => {
                                        setSelectedJob(t);
                                        fetchJobDetails(t.id);
                                    }}
                                    className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded inline-flex items-center gap-1 transition-colors"
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
