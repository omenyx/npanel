import { requestJson } from "@/shared/api/api-client";
import type { DnsRecord, DnsZoneName } from "@/features/domains/types";

export async function listZones(): Promise<{ zones: DnsZoneName[] }> {
  return requestJson("/v1/dns/zones");
}

export async function getZone(zoneName: DnsZoneName): Promise<{ zone: DnsZoneName; records: DnsRecord[] }> {
  return requestJson(`/v1/dns/zones/${encodeURIComponent(zoneName)}`);
}
