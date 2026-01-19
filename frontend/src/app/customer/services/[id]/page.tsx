"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Mail, Key } from "lucide-react";
import Link from "next/link";

interface HostingService {
  id: string;
  primaryDomain: string;
  planName: string;
  status: string;
}

export default function ServiceDetails() {
  const { id } = useParams();
  const router = useRouter();
  const [service, setService] = useState<HostingService | null>(null);
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingPasswordFor, setChangingPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = window.localStorage.getItem("npanel_access_token");
        const headers = { Authorization: `Bearer ${token}` };
        
        const [serviceRes, mailboxesRes] = await Promise.all([
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}`, { headers }),
            fetch(`http://127.0.0.1:3000/v1/customer/hosting/services/${id}/mailboxes`, { headers })
        ]);

        if (serviceRes.ok && mailboxesRes.ok) {
          setService(await serviceRes.json());
          setMailboxes(await mailboxesRes.json());
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

      {/* Mailboxes Section */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-medium text-white flex items-center gap-2">
                <Mail className="h-5 w-5 text-zinc-400" />
                Mailboxes
            </h2>
        </div>

        <div className="space-y-2">
            {mailboxes.length === 0 ? (
                <div className="text-sm text-zinc-500 italic">No mailboxes found.</div>
            ) : (
                mailboxes.map(mailbox => (
                    <div key={mailbox} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 p-4">
                        <span className="font-mono text-sm text-zinc-300">{mailbox}</span>
                        <button
                            onClick={() => setChangingPasswordFor(mailbox)}
                            className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
                        >
                            <Key className="h-3 w-3" />
                            Change Password
                        </button>
                    </div>
                ))
            )}
        </div>
      </div>

      {/* Change Password Modal */}
      {changingPasswordFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
                <h3 className="mb-4 text-lg font-medium text-white">Change Password</h3>
                <p className="mb-4 text-sm text-zinc-400">
                    Update password for <span className="font-mono text-white">{changingPasswordFor}</span>
                </p>
                
                {error && (
                    <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-4">
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
