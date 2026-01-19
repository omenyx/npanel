import Link from "next/link";
import { PanelLeft, Server, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-50">
      <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-950/80 px-10 py-10 shadow-2xl backdrop-blur">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/40">
              <PanelLeft className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Npanel Control Plane
              </h1>
              <p className="text-xs text-zinc-400">
                Central brain for accounts, hosting, and safe cPanel migrations.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="uppercase tracking-tight text-emerald-300">
                V1 foundations online
              </span>
            </div>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)]">
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Npanel V1 gives you a secure IAM layer, customer and hosting
              inventory, and a resumable rsync-based migration engine tuned for
              modern cPanel stacks.
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
              <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>JWT + role-based access</span>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
                <Server className="h-3.5 w-3.5 text-sky-400" />
                <span>Accounts &amp; hosting inventory</span>
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <p className="text-xs text-zinc-400">
              Ready to manage your environment?
            </p>
            <Link
              href="/login"
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-500"
            >
              <PanelLeft className="h-4 w-4" />
              <span>Open admin console</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
