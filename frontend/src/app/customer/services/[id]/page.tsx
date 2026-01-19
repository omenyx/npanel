"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Key,
  Folder,
  RotateCcw,
  Database,
  Globe,
  Plus,
  Trash2,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

interface PlanLimits {
  diskQuotaMb: number;
  maxDatabases: number;
  maxMailboxes: number;
  mailboxQuotaMb: number;
}

interface HostingService {
  id: string;
  primaryDomain: string;
  planName: string;
  status: string;
  createdAt: string;
  planLimits: PlanLimits | null;
}

interface FtpCredentials {
  host: string;
  username: string;
}

interface DnsRecord {
  name: string;
  type: string;
  data: string;
}

export default function ServiceDetails() {
  const { id } = useParams();
  const router = useRouter();
  const [service, setService] = useState<HostingService | null>(null);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [ftp, setFtp] = useState<FtpCredentials | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingPasswordFor, setChangingPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resettingFtp, setResettingFtp] = useState(false);
  const [resettingDb, setResettingDb] = useState(false);
  const [creatingMailbox, setCreatingMailbox] = useState(false);
  const [newMailboxLocalPart, setNewMailboxLocalPart] = useState("");
  const [deletingMailboxFor, setDeletingMailboxFor] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = window.localStorage.getItem("npanel_access_token");
        const headers = { Authorization: `Bearer ${token}` };
        
        const [serviceRes, mailboxesRes, ftpRes, dbRes, dnsRes] = await Promise.all([
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}`, { headers }),
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes`, { headers }),
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/ftp`, { headers }),
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/databases`, { headers }),
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/dns`, { headers }),
        ]);

        if (serviceRes.ok && mailboxesRes.ok && ftpRes.ok && dbRes.ok && dnsRes.ok) {
          setService(await serviceRes.json());
          setMailboxes(await mailboxesRes.json());
          setFtp(await ftpRes.json());
          const dbData = await dbRes.json();
          setDatabases(dbData.databases || []);
          const dnsData = await dnsRes.json();
          setDnsRecords(dnsData.records || []);
        } else {
            router.push('/customer'); // fallback
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, router]);

  const refreshMailboxes = async () => {
    try {
      const token = window.localStorage.getItem("npanel_access_token");
      const headers = { Authorization: `Bearer ${token}` };
      const res = await fetch(
        `http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes`,
        { headers },
      );
      if (!res.ok) return;
      setMailboxes(await res.json());
    } catch {
      return;
    }
  };

  const handleCreateMailbox = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = window.localStorage.getItem("npanel_access_token");
      const res = await fetch(
        `http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            localPart: newMailboxLocalPart,
            password: newPassword,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create mailbox");
      }
      setCreatingMailbox(false);
      setNewMailboxLocalPart("");
      setNewPassword("");
      await refreshMailboxes();
      alert("Mailbox created successfully");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMailbox = async () => {
    if (!deletingMailboxFor) return;
    setSaving(true);
    setError(null);
    try {
      const token = window.localStorage.getItem("npanel_access_token");
      const res = await fetch(
        `http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes/delete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            address: deletingMailboxFor,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete mailbox");
      }
      setDeletingMailboxFor(null);
      await refreshMailboxes();
      alert("Mailbox deleted");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDatabasePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = window.localStorage.getItem("npanel_access_token");
      const res = await fetch(
        `http://127.0.0.1:3000/v1/customer/hosting/services/${id}/databases/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            password: newPassword,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to reset database password");
      }

      setResettingDb(false);
      setNewPassword("");
      alert("Database password reset successfully");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetFtpPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = window.localStorage.getItem("npanel_access_token");
      const res = await fetch(
        `http://127.0.0.1:3000/v1/customer/hosting/services/${id}/ftp/password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            password: newPassword,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to reset FTP password");
      }

      setResettingFtp(false);
      setNewPassword("");
      alert("FTP password reset successfully");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingPasswordFor) return;
    
    setSaving(true);
    setError(null);
    try {
        const token = window.localStorage.getItem("npanel_access_token");
        const res = await fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes/password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                address: changingPasswordFor,
                password: newPassword
            })
        });
        
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.message || 'Failed to update password');
        }
        
        setChangingPasswordFor(null);
        setNewPassword("");
        alert('Password updated successfully');
    } catch (err: any) {
        setError(err.message);
    } finally {
        setSaving(false);
    }
  };

  if (loading) return <div className="text-zinc-400">Loading...</div>;
  if (!service) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customer" className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-white">{service.primaryDomain}</h1>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Folder className="h-5 w-5 text-zinc-400" />
            Files
          </h2>
          <button
            onClick={() => setResettingFtp(true)}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset FTP Password
          </button>
        </div>

        {ftp ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-500">FTP Host</div>
              <div className="mt-1 font-mono text-sm text-white">{ftp.host}</div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
              <div className="text-xs text-zinc-500">FTP Username</div>
              <div className="mt-1 font-mono text-sm text-white">{ftp.username}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">FTP information is unavailable.</div>
        )}

        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          Use an FTP client like FileZilla. Connect with the host and username above, then use the password you set with “Reset FTP Password”.
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-zinc-400" />
            Databases
          </h2>
          <button
            onClick={() => setResettingDb(true)}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Database Password
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <div className="text-xs text-zinc-500">Database Host</div>
            <div className="mt-1 font-mono text-sm text-white">127.0.0.1</div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <div className="text-xs text-zinc-500">Databases</div>
            {databases.length === 0 ? (
              <div className="mt-1 text-sm text-zinc-500">No databases found.</div>
            ) : (
              <div className="mt-2 space-y-2">
                {databases.map((db) => (
                  <div
                    key={db}
                    className="rounded-md border border-zinc-800 bg-black px-3 py-2 font-mono text-sm text-zinc-200"
                  >
                    {db}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Globe className="h-5 w-5 text-zinc-400" />
            DNS (Read-only)
          </h2>
        </div>

        {dnsRecords.length === 0 ? (
          <div className="text-sm text-zinc-500 italic">No DNS records found.</div>
        ) : (
          <div className="overflow-hidden rounded-md border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-black">
                {dnsRecords.map((record, idx) => (
                  <tr key={`${record.name}-${record.type}-${idx}`} className="text-zinc-200">
                    <td className="px-4 py-3 font-mono">{record.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          ["A", "MX", "TXT"].includes(record.type.toUpperCase())
                            ? "bg-indigo-500/10 text-indigo-300"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {record.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">
                      {record.data}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mailboxes Section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-medium text-white flex items-center gap-2">
                <Mail className="h-5 w-5 text-zinc-400" />
                Mailboxes
            </h2>
            <div className="flex items-center gap-2">
              <a
                href={`http://${service.primaryDomain}/webmail`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Webmail
              </a>
              <button
                onClick={() => setCreatingMailbox(true)}
                className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Mailbox
              </button>
            </div>
        </div>

        <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
          Quota per mailbox{" "}
          <span className="font-mono text-white">
            {service.planLimits ? `${service.planLimits.mailboxQuotaMb} MB` : "—"}
          </span>
          . Usage details may not be available on all servers.
        </div>

        <div className="space-y-2">
            {mailboxes.length === 0 ? (
                <div className="text-sm text-zinc-500 italic">No mailboxes found.</div>
            ) : (
                mailboxes.map(mailbox => (
                    <div key={mailbox} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 p-4">
                        <span className="font-mono text-sm text-zinc-300">{mailbox}</span>
                        <div className="flex items-center gap-2">
                          <button
                              onClick={() => setChangingPasswordFor(mailbox)}
                              className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
                          >
                              <Key className="h-3 w-3" />
                              Reset Password
                          </button>
                          <button
                            onClick={() => setDeletingMailboxFor(mailbox)}
                            className="flex items-center gap-2 rounded-md border border-zinc-800 bg-black px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </button>
                        </div>
                    </div>
                ))
            )}
        </div>
      </div>

      {creatingMailbox && service && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-medium text-white">Create Mailbox</h3>

            {error && (
              <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateMailbox} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Mailbox Name</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={newMailboxLocalPart}
                    onChange={(e) => setNewMailboxLocalPart(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    placeholder="e.g. info"
                  />
                  <span className="text-sm text-zinc-500">@{service.primaryDomain}</span>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  placeholder="Set a password"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreatingMailbox(false);
                    setError(null);
                    setNewMailboxLocalPart("");
                    setNewPassword("");
                  }}
                  className="flex-1 rounded-md border border-zinc-800 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingMailboxFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-medium text-white">Delete Mailbox</h3>
            <p className="mb-4 text-sm text-zinc-400">
              This will permanently delete{" "}
              <span className="font-mono text-white">{deletingMailboxFor}</span>.
            </p>

            {error && (
              <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeletingMailboxFor(null);
                  setError(null);
                }}
                className="flex-1 rounded-md border border-zinc-800 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleDeleteMailbox}
                className="flex-1 rounded-md bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {(changingPasswordFor || resettingFtp || resettingDb) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
                <h3 className="mb-4 text-lg font-medium text-white">
                  {resettingFtp
                    ? "Reset FTP Password"
                    : resettingDb
                      ? "Reset Database Password"
                      : "Change Password"}
                </h3>
                {changingPasswordFor && (
                  <p className="mb-4 text-sm text-zinc-400">
                      Update password for <span className="font-mono text-white">{changingPasswordFor}</span>
                  </p>
                )}
                
                {error && (
                    <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                <form
                  onSubmit={
                    resettingFtp
                      ? handleResetFtpPassword
                      : resettingDb
                        ? handleResetDatabasePassword
                        : handleChangePassword
                  }
                  className="space-y-4"
                >
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-400">New Password</label>
                        <input
                            type="password"
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                            placeholder="Enter new password"
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => {
                                setChangingPasswordFor(null);
                                setResettingFtp(false);
                                setResettingDb(false);
                                setError(null);
                                setNewPassword("");
                            }}
                            className="flex-1 rounded-md border border-zinc-800 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                            {saving ? "Updating..." : "Update Password"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
}
