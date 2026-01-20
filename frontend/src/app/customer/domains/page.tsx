"use client";

import * as React from "react";
import Link from "next/link";
import { Globe } from "lucide-react";
import { requestJson } from "@/shared/api/api-client";
import { Button } from "@/shared/ui/button";

type HostingService = { id: string; primaryDomain: string; status: string };

export default function CustomerDomainsPage() {
  const [services, setServices] = React.useState<HostingService[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await requestJson<HostingService[]>("/v1/customer/hosting/services");
        setServices(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load services.");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Globe className="h-6 w-6 text-primary" />
        Domains
      </h1>
      {error ? (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="card p-4">
        <div className="text-sm font-semibold text-text-main mb-2">My Services</div>
        <div className="text-xs text-text-muted mb-4">
          Manage DNS per service from the service detail view.
        </div>
        <div className="grid gap-2">
          {services.map((s) => (
            <Button key={s.id} asChild variant="secondary" className="justify-between">
              <Link href={`/customer/services/${s.id}`}>
                <span className="font-medium text-text-main">{s.primaryDomain}</span>
                <span className="text-xs text-text-muted">{s.status}</span>
              </Link>
            </Button>
          ))}
          {!loading && services.length === 0 ? (
            <div className="text-sm text-text-muted">No services found.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

