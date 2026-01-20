import type { DnsRecord, DnsRecordType, DnsZoneName } from "@/features/domains/types";

export function validateZoneName(zoneName: DnsZoneName): string | null {
  const value = zoneName.trim().toLowerCase();
  if (!value) return "Zone name is required.";
  if (value.length > 253) return "Zone name is too long.";
  if (value.includes("..")) return "Zone name is invalid.";
  if (value.startsWith(".") || value.endsWith(".")) return "Zone name is invalid.";

  const labels = value.split(".");
  if (labels.length < 2) return "Zone name must be a fully-qualified domain (example.com).";
  for (const label of labels) {
    if (!label) return "Zone name is invalid.";
    if (label.length > 63) return "Zone name is invalid.";
    if (!/^[a-z0-9-]+$/.test(label)) return "Zone name contains invalid characters.";
    if (label.startsWith("-") || label.endsWith("-")) return "Zone name is invalid.";
  }
  return null;
}

export function normalizeZoneName(zoneName: string): string {
  return zoneName.trim().toLowerCase();
}

export function getSupportedRecordTypes(): DnsRecordType[] {
  return ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA"];
}

export function validateRecord(record: DnsRecord): string | null {
  if (!record.name.trim()) return "Record name is required.";
  if (!record.data.trim()) return "Record data is required.";
  if (!getSupportedRecordTypes().includes(record.type)) return "Record type is invalid.";
  if (record.ttl !== undefined) {
    if (!Number.isFinite(record.ttl)) return "TTL is invalid.";
    if (record.ttl < 0) return "TTL is invalid.";
    if (record.ttl > 2_147_483_647) return "TTL is invalid.";
  }
  return null;
}

export function filterEmptyRecords(records: DnsRecord[]): DnsRecord[] {
  return records
    .map((r) => ({
      ...r,
      name: r.name.trim(),
      data: r.data.trim(),
    }))
    .filter((r) => r.name.length > 0 || r.data.length > 0);
}

