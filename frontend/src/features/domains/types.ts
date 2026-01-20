export type DnsZoneName = string;

export type DnsRecordType =
  | "A"
  | "AAAA"
  | "CNAME"
  | "MX"
  | "TXT"
  | "NS"
  | "SOA"
  | "SRV"
  | "CAA";

export type DnsRecord = {
  name: string;
  type: DnsRecordType;
  data: string;
  ttl?: number;
};

