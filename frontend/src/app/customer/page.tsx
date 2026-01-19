"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Server, ExternalLink } from "lucide-react";

interface HostingService {
  id: string;
  primaryDomain: string;
  planName: string;
  status: string;
  createdAt: string;
}

export default function CustomerDashboard() {
  const [services, setServices] = useState<HostingService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const token = window.localStorage.getItem("npanel_access_token");
        const res = await fetch("http://127.0.0.1:3000/v1/customer/hosting/services", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setServices(data);
        }
      } catch (err) {
        console.error(err);
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
