"use client";

import * as React from "react";
import { Key, LogOut, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { clearSession } from "@/shared/auth/session";
import { requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
  type GovernedResult,
} from "@/shared/ui/governed-action-dialog";

export default function AdminSecurityPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = React.useState(false);
  const [actionDialogTitle, setActionDialogTitle] = React.useState("");
  const [actionConfirmation, setActionConfirmation] =
    React.useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = React.useState<
    ((intentId: string, token: string) => Promise<GovernedResult<any>>) | null
  >(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const confirmation = await requestJson<GovernedConfirmation>("/v1/auth/change-password/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setActionDialogTitle("Confirm Password Change");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<GovernedResult<any>>("/v1/auth/change-password/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        if (res.status === "SUCCESS") {
          setCurrentPassword("");
          setNewPassword("");
          setSuccess("Password updated.");
        }
        return res;
      });
      setActionDialogOpen(true);
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
      const confirmation = await requestJson<GovernedConfirmation>("/v1/auth/logout-all/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setActionDialogTitle("Confirm Logout All Sessions");
      setActionConfirmation(confirmation);
      setConfirmFn(() => async (intentId: string, confirmToken: string) => {
        const res = await requestJson<GovernedResult<any>>("/v1/auth/logout-all/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, token: confirmToken }),
        });
        if (res.status === "SUCCESS") {
          clearSession();
          router.push("/login");
        }
        return res;
      });
      setActionDialogOpen(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <GovernedActionDialog
        open={actionDialogOpen}
        title={actionDialogTitle}
        confirmation={actionConfirmation}
        onClose={() => {
          setActionDialogOpen(false);
          setActionConfirmation(null);
          setConfirmFn(null);
        }}
        onConfirm={async (intentId, token) => {
          if (!confirmFn) throw new Error("No confirm handler");
          return confirmFn(intentId, token);
        }}
      />
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
