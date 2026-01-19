"use client";

import { useEffect, useState } from "react";
import { Globe, Plus, Trash2, Edit, RefreshCw, AlertCircle } from "lucide-react";
import Link from "next/link";

type Zone = string;

export default function DnsZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchZones = async () => {
    setLoading(true);
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) return;

    try {
      const res = await fetch("http://127.0.0.1:3000/v1/dns/zones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setZones(data.zones);
      } else {
        setError("Failed to load zones");
      }
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
  }, []);

  const handleCreate = async () => {
    if (!newZoneName.trim()) return;
    setCreating(true);
    const token = window.localStorage.getItem("npanel_access_token");
    try {
      const res = await fetch("http://127.0.0.1:3000/v1/dns/zones", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          zoneName: newZoneName,
          records: [
            {
              name: "@",
              type: "SOA",
              data: `ns1.${newZoneName}. hostmaster.${newZoneName}. 1 3600 900 1209600 300`,
            },
            { name: "@", type: "NS", data: `ns1.${newZoneName}.` },
            { name: "ns1", type: "A", data: "127.0.0.1" },
          ],
        }),
      });

      if (res.ok) {
        setShowCreate(false);
        setNewZoneName("");
        fetchZones();
      } else {
        alert("Failed to create zone");
      }
    } catch (e) {
      alert("Error creating zone");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (zone: string) => {
    if (!confirm(`Are you sure you want to delete the zone ${zone}? This cannot be undone.`)) return;
    setDeleting(zone);
    setError(null);
    const token = window.localStorage.getItem("npanel_access_token");
    if (!token) {
        setDeleting(null);
        return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/dns/zones/${zone}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchZones();
      } else {
        setError("Failed to delete zone");
      }
    } catch (e) {
      setError("Error deleting zone");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Globe className="h-6 w-6 text-purple-500" />
          DNS Zones
        </h1>
        <div className="flex gap-2">
            <button
                onClick={fetchZones}
                className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 rounded text-sm transition-colors"
            >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
            >
                <Plus className="h-4 w-4" />
                New Zone
            </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/50 text-red-500 px-4 py-2 rounded text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {showCreate && (
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex flex-col md:flex-row gap-4 items-end animate-in fade-in slide-in-from-top-4">
          <div className="flex-1 w-full">
            <label className="block text-xs uppercase text-zinc-500 mb-1 font-medium">Zone Name</label>
            <input
              type="text"
              placeholder="example.com"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
              autoFocus
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={handleCreate}
              disabled={creating || !newZoneName}
              className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 md:flex-none bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm text-zinc-400">
          <thead className="bg-zinc-950 text-xs uppercase text-zinc-500 font-medium">
            <tr>
              <th className="px-4 py-3">Zone Name</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {zones.map((zone) => (
              <tr key={zone} className="hover:bg-zinc-800/50 transition-colors">
                <td className="px-4 py-3 text-zinc-200 font-medium font-mono">{zone}</td>
                <td className="px-4 py-3 text-right flex justify-end gap-2">
                  <Link
                    href={`/admin/dns/${zone}`}
                    className="flex items-center gap-1 bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-400 px-2 py-1 rounded text-xs transition-colors"
                  >
                    <Edit className="h-3 w-3" />
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(zone)}
                    disabled={deleting === zone}
                    className="flex items-center gap-1 bg-zinc-800 hover:bg-red-600 hover:text-white text-zinc-400 px-2 py-1 rounded text-xs transition-colors disabled:opacity-50"
                  >
                    {deleting === zone ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {zones.length === 0 && !loading && (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-zinc-600 italic border-dashed border-zinc-800">
                  No DNS zones found. Create one to get started.
                </td>
              </tr>
            )}
            {loading && zones.length === 0 && (
                <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-zinc-500">
                        <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                        Loading zones...
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
