"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Server, ExternalLink, HardDrive, Database, Mail } from "lucide-react";
import { getAccessToken, requestJson } from "@/shared/api/api-client";

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

export default function CustomerDashboard() {
  const [services, setServices] = useState<HostingService[]>([]);
  const [loading, setLoading] = useState(true);

  const formatDisk = (mb: number) => {
    if (!Number.isFinite(mb) || mb < 0) return "—";
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const token = getAccessToken();
        if (!token) return;
        const data = await requestJson<HostingService[]>("/v1/customer/hosting/services");
        setServices(data);
      } catch (err) {
        return;
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  if (loading) {
    return <div className="text-zinc-400">Loading services...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">My Hosting Services</h1>
      
      {services.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-zinc-400">
          No hosting services found.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <div
              key={service.id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-indigo-500/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800">
                    <Server className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{service.primaryDomain}</h3>
                    <p className="text-sm text-zinc-400">{service.planName}</p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    service.status === "active"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {service.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <HardDrive className="h-3.5 w-3.5" />
                    Disk
                  </div>
                  <div className="mt-1 text-sm text-white">
                    {service.planLimits ? formatDisk(service.planLimits.diskQuotaMb) : "—"}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Database className="h-3.5 w-3.5" />
                    Databases
                  </div>
                  <div className="mt-1 text-sm text-white">
                    {service.planLimits ? service.planLimits.maxDatabases : "—"}
                  </div>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Mail className="h-3.5 w-3.5" />
                    Mailboxes
                  </div>
                  <div className="mt-1 text-sm text-white">
                    {service.planLimits ? service.planLimits.maxMailboxes : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-zinc-500">
                Created{" "}
                {service.createdAt
                  ? new Date(service.createdAt).toLocaleDateString()
                  : "—"}
              </div>
              
              <div className="mt-6 flex gap-3">
                <Link
                  href={`/customer/services/${service.id}`}
                  className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  Manage
                </Link>
                {service.status === 'active' && (
                    <a
                    href={`http://${service.primaryDomain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                    <ExternalLink className="h-4 w-4" />
                    </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
