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
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          DNS Zones
        </h1>
        <div className="flex gap-2">
            <button
                onClick={fetchZones}
                className="btn-secondary"
            >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
                onClick={() => setShowCreate(true)}
                className="btn-primary"
            >
                <Plus className="h-4 w-4" />
                New Zone
            </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger px-4 py-2 rounded-[var(--radius-card)] text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {showCreate && (
        <div className="card p-4 flex flex-col md:flex-row gap-4 items-end animate-in fade-in slide-in-from-top-4">
          <div className="flex-1 w-full">
            <label className="label-text">Zone Name</label>
            <input
              type="text"
              placeholder="example.com"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              className="input-field"
              autoFocus
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <button
              onClick={handleCreate}
              disabled={creating || !newZoneName}
              className="flex-1 md:flex-none btn-primary bg-success hover:bg-success-hover text-success-fg border-success"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 md:flex-none btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm text-text-muted">
          <thead className="table-header">
            <tr>
              <th className="px-4 py-3">Zone Name</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {zones.map((zone) => (
              <tr key={zone} className="table-row">
                <td className="px-4 py-3 text-text-main font-medium font-mono">{zone}</td>
                <td className="px-4 py-3 text-right flex justify-end gap-2">
                  <Link
                    href={`/admin/dns/${zone}`}
                    className="flex items-center gap-1 btn-secondary text-xs px-2 py-1 h-auto"
                  >
                    <Edit className="h-3 w-3" />
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(zone)}
                    disabled={deleting === zone}
                    className="flex items-center gap-1 btn-secondary text-xs px-2 py-1 h-auto hover:bg-danger hover:text-danger-fg hover:border-danger"
                  >
                    {deleting === zone ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {zones.length === 0 && !loading && (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center text-text-muted italic">
                  No DNS zones found. Create one to get started.
                </td>
              </tr>
            )}
            {loading && zones.length === 0 && (
                <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-text-muted">
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
