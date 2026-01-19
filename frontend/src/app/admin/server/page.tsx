"use client";

import { useEffect, useState } from "react";
import { Server, RefreshCw, CheckCircle, XCircle, AlertTriangle, Cpu, HardDrive, Database, Activity, Play } from "lucide-react";

type ToolStatus = {
  name: string;
  available: boolean;
  path?: string;
  method?: string;
  error?: string;
  packageHint?: string;
};

type ServerInfo = {
  defaultIpv4: string;
  dnsBackend: string;
  mailBackend: string;
  ftpBackend: string;
};

type SystemStats = {
  loadAvg: number[];
  memory: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  uptime: number;
};

type SystemStatusResponse = {
  tools: ToolStatus[]; // Kept for reference or debug if needed, but not shown primarily
  serverInfo: ServerInfo;
  systemStats?: SystemStats;
};

const MANAGED_SERVICES = [
  { id: 'nginx', label: 'Nginx Web Server' },
  { id: 'php-fpm', label: 'PHP-FPM' },
  { id: 'mysql', label: 'MySQL Database' },
  { id: 'pdns_server', label: 'PowerDNS' },
  { id: 'exim4', label: 'Exim Mail Server' },
  { id: 'dovecot', label: 'Dovecot IMAP/POP3' },
  { id: 'ssh', label: 'SSH Server' },
  { id: 'npanel-backend', label: 'Npanel Backend' },
];

export default function ServerPage() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restartingService, setRestartingService] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    let token: string | null = null;
    try {
      token = window.localStorage.getItem("npanel_access_token");
    } catch {
      token = null;
    }
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("http://127.0.0.1:3000/system/tools/status", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch system status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleRestartService = async (serviceId: string) => {
    if (!confirm(`Are you sure you want to restart ${serviceId}?`)) return;
    
    setRestartingService(serviceId);
    const token = window.localStorage.getItem("npanel_access_token");
    try {
      const res = await fetch("http://127.0.0.1:3000/system/tools/restart-service", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ service: serviceId }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to restart service");
      }
      
      alert(`Service ${serviceId} restarted successfully.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to restart service");
    } finally {
      setRestartingService(null);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  if (loading && !status) {
    return <div className="text-zinc-500">Loading server status...</div>;
  }

  if (error) {
    return <div className="text-red-500">Error: {error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Server className="h-6 w-6 text-blue-500" />
          Server Status
        </h1>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded text-sm transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {status && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
             {/* System Load */}
             <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Activity className="h-4 w-4" />
                  <span className="text-sm font-medium">Load Average</span>
                </div>
                {status.systemStats ? (
                  <div className="text-2xl font-mono text-white">
                    {status.systemStats.loadAvg.map(l => l.toFixed(2)).join(' ')}
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm">Not available</div>
                )}
             </div>

             {/* Memory */}
             <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Database className="h-4 w-4" />
                  <span className="text-sm font-medium">Memory Usage</span>
                </div>
                {status.systemStats ? (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-white">{formatBytes(status.systemStats.memory.used)}</span>
                      <span className="text-zinc-500">{formatBytes(status.systemStats.memory.total)}</span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
                        style={{ width: `${status.systemStats.memory.percent}%` }}
                      ></div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 mt-1">{status.systemStats.memory.percent}%</div>
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm">Not available</div>
                )}
             </div>

             {/* Disk */}
             <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <HardDrive className="h-4 w-4" />
                  <span className="text-sm font-medium">Disk Usage (/)</span>
                </div>
                {status.systemStats ? (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-white">{formatBytes(status.systemStats.disk.used)}</span>
                      <span className="text-zinc-500">{formatBytes(status.systemStats.disk.total)}</span>
                    </div>
                    <div className="w-full bg-zinc-800 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-500 ${status.systemStats.disk.percent > 90 ? 'bg-red-500' : 'bg-emerald-500'}`}
                        style={{ width: `${status.systemStats.disk.percent}%` }}
                      ></div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 mt-1">{status.systemStats.disk.percent}%</div>
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm">Not available</div>
                )}
             </div>

             {/* Uptime */}
             <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-zinc-400">
                  <Cpu className="h-4 w-4" />
                  <span className="text-sm font-medium">Uptime</span>
                </div>
                {status.systemStats ? (
                  <div className="text-xl font-mono text-white">
                    {formatUptime(status.systemStats.uptime)}
                  </div>
                ) : (
                  <div className="text-zinc-500 text-sm">Not available</div>
                )}
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Server Info (Kept) */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-zinc-200 mb-4">Network & Backends</h2>
              <div className="space-y-3">
                <div className="flex justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">Default IPv4</span>
                  <span className="font-mono text-zinc-200">{status.serverInfo.defaultIpv4}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">DNS Backend</span>
                  <span className="text-zinc-200">{status.serverInfo.dnsBackend}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">Mail Backend</span>
                  <span className="text-zinc-200">{status.serverInfo.mailBackend}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">FTP Backend</span>
                  <span className="text-zinc-200">{status.serverInfo.ftpBackend}</span>
                </div>
              </div>
            </div>

            {/* Service Management (New) */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
               <h2 className="text-lg font-semibold text-zinc-200 mb-4">Service Management</h2>
               <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                 {MANAGED_SERVICES.map(svc => (
                   <div key={svc.id} className="flex items-center justify-between bg-zinc-950 p-3 rounded border border-zinc-800">
                     <span className="text-sm text-zinc-300 font-medium">{svc.label}</span>
                     <button
                        onClick={() => handleRestartService(svc.id)}
                        disabled={restartingService === svc.id}
                        className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-blue-600 text-zinc-200 text-xs rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                       {restartingService === svc.id ? (
                         <RefreshCw className="h-3 w-3 animate-spin" />
                       ) : (
                         <Play className="h-3 w-3" />
                       )}
                       Restart
                     </button>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
