"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import Link from "next/link";

type DnsRecord = {
  name: string;
  type: string;
  data: string;
  ttl?: number;
};

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA"];

export default function EditZonePage() {
  const { zone } = useParams();
  const router = useRouter();
  
  // Decoding the zone name is important if it contains special chars, though usually DNS names don't.
  // But params are URL encoded.
  const zoneName = decodeURIComponent(zone as string);

  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchRecords = async () => {
    setLoading(true);
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/dns/zones/${zoneName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records);
      } else {
        setError("Failed to load records");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (zoneName) fetchRecords();
  }, [zoneName]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    const token = window.localStorage.getItem("npanel_access_token");
    
    // Basic validation
    // Filter out empty rows if any
    const validRecords = records.filter(r => r.name.trim() !== "" && r.data.trim() !== "");

    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/dns/zones/${zoneName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ records: validRecords }),
      });

      if (res.ok) {
        setSuccess("Zone saved successfully");
        fetchRecords(); // Refresh to ensure sync
      } else {
        setError("Failed to save zone");
      }
    } catch (e) {
      setError("Error saving zone");
    } finally {
      setSaving(false);
    }
  };

  const addRecord = () => {
    setRecords([...records, { name: "", type: "A", data: "", ttl: 300 }]);
  };

  const removeRecord = (index: number) => {
    const newRecords = [...records];
    newRecords.splice(index, 1);
    setRecords(newRecords);
  };

  const updateRecord = (index: number, field: keyof DnsRecord, value: string | number) => {
    const newRecords = [...records];
    newRecords[index] = { ...newRecords[index], [field]: value };
    setRecords(newRecords);
  };

  if (loading && records.length === 0) {
      return (
          <div className="flex items-center justify-center h-64 text-zinc-500">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              Loading records for {zoneName}...
          </div>
      );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
            <Link href="/admin/dns" className="text-zinc-500 hover:text-white transition-colors">
                <ArrowLeft className="h-6 w-6" />
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                Edit Zone: <span className="text-purple-400 font-mono">{zoneName}</span>
                </h1>
                <p className="text-xs text-zinc-500 mt-1">Manage DNS records for this zone.</p>
            </div>
        </div>
        <div className="flex gap-2">
            <button
                onClick={fetchRecords}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 rounded text-sm transition-colors"
                title="Refresh Records"
            >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Changes"}
            </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-2 rounded text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/50 text-emerald-500 px-4 py-2 rounded text-sm flex items-center gap-2 animate-out fade-out duration-2000">
          <Save className="h-4 w-4" />
          {success}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-zinc-400">
          <thead className="bg-zinc-950 text-xs uppercase text-zinc-500 font-medium">
            <tr>
              <th className="px-4 py-3 w-1/4">Name</th>
              <th className="px-4 py-3 w-32">Type</th>
              <th className="px-4 py-3 w-24">TTL</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {records.map((record, index) => (
              <tr key={index} className="hover:bg-zinc-800/30 group">
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={record.name}
                    onChange={(e) => updateRecord(index, "name", e.target.value)}
                    placeholder="@"
                    className="w-full bg-transparent border border-transparent hover:border-zinc-700 focus:border-purple-500 rounded px-2 py-1 text-zinc-200 focus:outline-none font-mono text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <select
                    value={record.type}
                    onChange={(e) => updateRecord(index, "type", e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-purple-500 text-xs font-medium"
                  >
                    {RECORD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                   <input
                    type="number"
                    value={record.ttl || 300}
                    onChange={(e) => updateRecord(index, "ttl", parseInt(e.target.value))}
                    className="w-full bg-transparent border border-transparent hover:border-zinc-700 focus:border-purple-500 rounded px-2 py-1 text-zinc-400 focus:outline-none font-mono text-sm text-right"
                  />
                </td>
                <td className="px-4 py-2">
                   <input
                    type="text"
                    value={record.data}
                    onChange={(e) => updateRecord(index, "data", e.target.value)}
                    placeholder="1.2.3.4"
                    className="w-full bg-transparent border border-transparent hover:border-zinc-700 focus:border-purple-500 rounded px-2 py-1 text-zinc-200 focus:outline-none font-mono text-sm"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                    <button
                        onClick={() => removeRecord(index)}
                        className="text-zinc-600 hover:text-red-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete Record"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </td>
              </tr>
            ))}
            <tr>
                <td colSpan={5} className="px-4 py-3 bg-zinc-900/50">
                    <button
                        onClick={addRecord}
                        className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-xs font-medium uppercase tracking-wide"
                    >
                        <Plus className="h-4 w-4" />
                        Add Record
                    </button>
                </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <div className="bg-blue-900/10 border border-blue-900/30 p-4 rounded text-xs text-blue-300">
        <p className="font-semibold mb-1">Tips:</p>
        <ul className="list-disc list-inside space-y-1 opacity-80">
            <li>Use <strong>@</strong> for the zone apex (e.g. {zoneName}).</li>
            <li>For CNAME/MX/NS targets, ensure you include a trailing dot (e.g. <code>ns1.{zoneName}.</code>) if it is an absolute domain.</li>
            <li>TTL is in seconds (default 300).</li>
        </ul>
      </div>
    </div>
  );
}
