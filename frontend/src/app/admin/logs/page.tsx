"use client";

import { useEffect, useState, useRef } from "react";
import { Activity, RefreshCw, FileText, Database, Terminal } from "lucide-react";

type HostingLog = {
  id: string;
  adapter: string;
  operation: string;
  targetKind: string;
  targetKey: string;
  success: boolean;
  dryRun: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<'panel' | 'system'>('panel');
  
  // Panel Logs State
  const [logs, setLogs] = useState<HostingLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [errorLogs, setErrorLogs] = useState<string | null>(null);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  // System Logs State
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    setErrorLogs(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const res = await fetch("http://127.0.0.1:3000/v1/hosting/services/logs", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setLogs(await res.json());
      } else {
        throw new Error("Failed to fetch logs");
      }
    } catch (err) {
      setErrorLogs(`Failed to load panel logs: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchLogFiles = async () => {
    setLoadingFiles(true);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;
    try {
        const res = await fetch("http://127.0.0.1:3000/system/tools/logs/files", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
            const data = await res.json();
            setLogFiles(data.files || []);
            if (data.files && data.files.length > 0 && !selectedFile) {
                setSelectedFile(data.files[0]);
            }
        }
    } catch (e) {
        console.error("Failed to list log files");
    } finally {
        setLoadingFiles(false);
    }
  };

  const fetchFileContent = async (path: string) => {
      setLoadingFile(true);
      const token = window.localStorage.getItem("npanel_access_token");
      if (!token) return;
      try {
          const res = await fetch(`http://127.0.0.1:3000/system/tools/logs/content?path=${encodeURIComponent(path)}`, {
              headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
              const data = await res.json();
              setFileContent(data.content);
              // Auto scroll to bottom
              setTimeout(() => {
                  if (contentRef.current) {
                      contentRef.current.scrollTop = contentRef.current.scrollHeight;
                  }
              }, 100);
          } else {
              setFileContent("Failed to load file content.");
          }
      } catch (e) {
          setFileContent("Error loading file.");
      } finally {
          setLoadingFile(false);
      }
  };

  useEffect(() => {
    if (activeTab === 'panel') fetchLogs();
    if (activeTab === 'system') fetchLogFiles();
  }, [activeTab]);

  useEffect(() => {
      if (activeTab === 'system' && selectedFile) {
          fetchFileContent(selectedFile);
      }
  }, [selectedFile, activeTab]);

  const filteredLogs = showErrorsOnly
    ? logs.filter((log) => !log.success)
    : logs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Activity className="h-6 w-6 text-blue-500" />
          Logs / Status
        </h1>
        <div className="flex gap-2">
            <button 
                onClick={() => setActiveTab('panel')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'panel' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
            >
                <Database className="h-4 w-4" />
                Panel Logs
            </button>
            <button 
                onClick={() => setActiveTab('system')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'system' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
            >
                <Terminal className="h-4 w-4" />
                System Logs
            </button>
        </div>
      </div>

      {activeTab === 'panel' && (
          <>
            <div className="flex justify-end gap-3 mb-4">
                <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                    <input
                    type="checkbox"
                    checked={showErrorsOnly}
                    onChange={(e) => setShowErrorsOnly(e.target.checked)}
                    className="rounded border-zinc-800 bg-zinc-950 text-blue-600 focus:ring-blue-500"
                    />
                    Show Errors Only
                </label>
                <button
                    onClick={fetchLogs}
                    disabled={loadingLogs}
                    className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded text-sm transition-colors"
                >
                    <RefreshCw className={`h-4 w-4 ${loadingLogs ? "animate-spin" : ""}`} />
                    Refresh
                </button>
            </div>

            {errorLogs && (
                <div className="text-red-500 bg-red-900/10 border border-red-900/50 p-3 rounded">
                    {errorLogs}
                </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-sm text-zinc-400">
                    <thead className="bg-zinc-950 text-xs uppercase text-zinc-500 font-medium">
                        <tr>
                            <th className="px-4 py-3">Time</th>
                            <th className="px-4 py-3">Source</th>
                            <th className="px-4 py-3">Operation</th>
                            <th className="px-4 py-3">Target</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Message</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {filteredLogs.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                                    {logs.length === 0 ? "No logs found." : "No error logs found."}
                                </td>
                            </tr>
                        ) : (
                            filteredLogs.map(log => {
                                const isToolError = log.errorMessage?.includes('tool') || log.errorMessage?.includes('command');
                                return (
                                <tr key={log.id} className={`hover:bg-zinc-800/50 ${isToolError ? 'bg-red-900/5' : ''}`}>
                                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                                        {new Date(log.createdAt).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{log.adapter}</td>
                                    <td className="px-4 py-3 text-xs">{log.operation}</td>
                                    <td className="px-4 py-3 text-xs text-zinc-500">
                                        {log.targetKind}:{log.targetKey}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                                            log.success 
                                            ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-900/50' 
                                            : 'bg-red-900/30 text-red-400 border border-red-900/50'
                                        }`}>
                                            {log.success ? 'OK' : 'ERROR'}
                                        </span>
                                        {log.dryRun && <span className="ml-2 text-[10px] text-zinc-600">(dry)</span>}
                                    </td>
                                    <td className={`px-4 py-3 text-xs font-mono ${isToolError ? 'text-red-300 font-bold' : 'text-zinc-400'}`}>
                                        {log.errorMessage || '-'}
                                    </td>
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
          </>
      )}

      {activeTab === 'system' && (
          <div className="grid grid-cols-12 gap-6 h-[600px]">
              <div className="col-span-3 bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center justify-between">
                      Log Files
                      <button onClick={fetchLogFiles} className="text-zinc-500 hover:text-white">
                          <RefreshCw className={`h-3 w-3 ${loadingFiles ? 'animate-spin' : ''}`} />
                      </button>
                  </h3>
                  <div className="space-y-1">
                      {logFiles.map(file => (
                          <button
                              key={file}
                              onClick={() => setSelectedFile(file)}
                              className={`w-full text-left px-3 py-2 rounded text-xs truncate ${selectedFile === file ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'}`}
                              title={file}
                          >
                              {file.split('/').pop()}
                              <span className="block text-[10px] opacity-50">{file}</span>
                          </button>
                      ))}
                      {logFiles.length === 0 && !loadingFiles && (
                          <div className="text-xs text-zinc-600 italic">No logs found.</div>
                      )}
                  </div>
              </div>
              <div className="col-span-9 bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col h-full">
                  <div className="p-3 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                      <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-zinc-400" />
                          <span className="text-sm font-mono text-zinc-300">{selectedFile || 'Select a file'}</span>
                      </div>
                      <button 
                        onClick={() => selectedFile && fetchFileContent(selectedFile)}
                        disabled={!selectedFile || loadingFile}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded text-zinc-300 flex items-center gap-1"
                      >
                          <RefreshCw className={`h-3 w-3 ${loadingFile ? 'animate-spin' : ''}`} />
                          Tail (200)
                      </button>
                  </div>
                  <div 
                    ref={contentRef}
                    className="flex-1 overflow-auto p-4 font-mono text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed"
                  >
                      {loadingFile ? (
                          <div className="flex items-center justify-center h-full text-zinc-600">Loading content...</div>
                      ) : (
                          fileContent || <div className="text-zinc-600 italic">Select a log file to view its content (tail -n 200).</div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
