"use client";

import * as React from "react";
import { Key, LogOut, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { clearSession } from "@/shared/auth/session";
import { requestJson } from "@/shared/api/api-client";

export default function AdminSecurityPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await requestJson("/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("Password updated.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoutAll = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await requestJson("/v1/auth/logout-all", { method: "POST" });
      clearSession();
      router.push("/login");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Shield className="h-6 w-6 text-primary" />
        Security
      </h1>

      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-[var(--radius-card)] border border-success/20 bg-success/10 px-4 py-2 text-sm text-success">
          {success}
        </div>
      ) : null}

      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main mb-3 flex items-center gap-2">
          <Key className="h-4 w-4" />
          Change Password
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3 max-w-md">
          <div className="space-y-2">
            <label className="label-text">Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="label-text">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Update Password"}
            </Button>
          </div>
        </form>
      </div>

      <div className="card p-4 flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-text-main flex items-center gap-2">
            <LogOut className="h-4 w-4" />
            Logout All Sessions
          </div>
          <div className="text-xs text-text-muted">
            Invalidates all refresh tokens in the panel database.
          </div>
        </div>
        <Button variant="destructive" onClick={handleLogoutAll} disabled={saving}>
          Logout All
        </Button>
      </div>
    </div>
  );
}

