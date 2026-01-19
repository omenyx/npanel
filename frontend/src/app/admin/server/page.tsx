"use client";

import { useEffect, useState } from "react";
import { Server, RefreshCw, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

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

type SystemStatusResponse = {
  tools: ToolStatus[];
  serverInfo: ServerInfo;
};

export default function ServerPage() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

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

  useEffect(() => {
    fetchStatus();
  }, []);

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
               <h2 className="text-lg font-semibold text-zinc-200 mb-4">System Tools</h2>
               <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                 {status.tools.map(tool => (
                   <div key={tool.name} className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                     <div className="flex items-center gap-3">
                        {tool.available ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <div className="font-mono text-sm text-zinc-200">{tool.name}</div>
                          {tool.path && <div className="text-[10px] text-zinc-500">{tool.path}</div>}
                          {!tool.available && tool.packageHint && (
                             <div className="text-[10px] text-amber-500">Hint: Install {tool.packageHint}</div>
                          )}
                        </div>
                     </div>
                     <div className="text-[10px] uppercase text-zinc-600">
                       {tool.available ? "OK" : "MISSING"}
                     </div>
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
