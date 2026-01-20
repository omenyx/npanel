"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, LogOut } from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";
import {
  GovernedActionDialog,
  type GovernedConfirmation,
  type GovernedResult,
} from "@/shared/ui/governed-action-dialog";

export default function CustomerSecurityPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogTitle, setActionDialogTitle] = useState("");
  const [actionConfirmation, setActionConfirmation] =
    useState<GovernedConfirmation | null>(null);
  const [confirmFn, setConfirmFn] = useState<
    ((intentId: string, token: string) => Promise<GovernedResult<any>>) | null
  >(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = getAccessToken();
      if (!token) return;
      const confirmation = await requestJson<GovernedConfirmation>("/v1/auth/change-password/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
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
      const token = getAccessToken();
      if (!token) return;
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
          window.localStorage.removeItem("npanel_access_token");
          window.localStorage.removeItem("npanel_refresh_token");
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
      <h1 className="text-2xl font-bold text-white">Account Security</h1>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-4 flex items-center gap-2 text-lg font-medium text-white">
          <Key className="h-5 w-5 text-zinc-400" />
          Change Password
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-400">
            {success}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              New Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Update Password"}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-2 flex items-center gap-2 text-lg font-medium text-white">
          <LogOut className="h-5 w-5 text-zinc-400" />
          Sessions
        </div>
        <p className="mb-4 text-sm text-zinc-400">
          If you suspect your account is compromised, log out everywhere.
        </p>
        <button
          onClick={handleLogoutAll}
          disabled={saving}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? "Working..." : "Logout All Sessions"}
        </button>
      </div>
    </div>
  );
}
