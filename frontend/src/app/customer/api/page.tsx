"use client";

import * as React from "react";
import { Webhook } from "lucide-react";
import { env } from "@/shared/config/env";

export default function CustomerApiPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Webhook className="h-6 w-6 text-primary" />
        API & Integrations
      </h1>
      <div className="card p-4 space-y-3">
        <div className="text-sm font-semibold text-text-main">API Base URL</div>
        <pre className="rounded-[var(--radius-card)] border border-border bg-surface-hover p-3 text-xs text-text-main overflow-x-auto">
          {env.apiBaseUrl}
        </pre>
      </div>
    </div>
  );
}

