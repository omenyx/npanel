import { requestJson } from "@/shared/api/api-client";
import type { DnsRecord, DnsZoneName } from "@/features/domains/types";

export async function listZones(): Promise<{ zones: DnsZoneName[] }> {
  return requestJson("/v1/dns/zones");
}

export async function getZone(zoneName: DnsZoneName): Promise<{ zone: DnsZoneName; records: DnsRecord[] }> {
  return requestJson(`/v1/dns/zones/${encodeURIComponent(zoneName)}`);
}

export async function createZone(input: { zoneName: DnsZoneName; records: DnsRecord[] }) {
  return requestJson("/v1/dns/zones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateZone(zoneName: DnsZoneName, input: { records: DnsRecord[] }) {
  return requestJson(`/v1/dns/zones/${encodeURIComponent(zoneName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteZone(zoneName: DnsZoneName) {
  return requestJson(`/v1/dns/zones/${encodeURIComponent(zoneName)}`, {
    method: "DELETE",
  });
}

