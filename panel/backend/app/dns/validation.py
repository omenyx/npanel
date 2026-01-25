from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass


ALLOWED_TYPES = {"A", "AAAA", "CNAME", "TXT", "MX", "SRV", "NS", "CAA"}


@dataclass(frozen=True)
class ValidatedRRSet:
    name: str
    rtype: str
    ttl: int
    records: list[str]


def _fqdn(name: str) -> str:
    n = (name or "").strip()
    if not n:
        raise ValueError("missing name")
    if not n.endswith("."):
        n += "."
    return n.lower()


def _require_in_zone(record_name: str, zone_name: str) -> None:
    rn = _fqdn(record_name)
    zn = _fqdn(zone_name)
    if rn == zn:
        return
    if not rn.endswith(zn):
        raise ValueError("record name must be within zone")


def _validate_ttl(ttl: int) -> int:
    if ttl < 60 or ttl > 86400:
        raise ValueError("ttl out of range")
    return ttl


def _validate_content(rtype: str, content: str) -> str:
    c = (content or "").strip()
    if not c:
        raise ValueError("empty record content")

    if rtype == "A":
        ipaddress.IPv4Address(c)
        return c
    if rtype == "AAAA":
        ipaddress.IPv6Address(c)
        return c
    if rtype in {"CNAME", "NS"}:
        return _fqdn(c)
    if rtype == "TXT":
        if len(c) > 2048:
            raise ValueError("txt too long")
        # PowerDNS accepts raw strings (it will quote as needed). We keep it as-is.
        return c
    if rtype == "MX":
        parts = c.split()
        if len(parts) != 2:
            raise ValueError("mx must be: <priority> <host>")
        prio = int(parts[0])
        if prio < 0 or prio > 65535:
            raise ValueError("mx priority out of range")
        host = _fqdn(parts[1])
        return f"{prio} {host}"
    if rtype == "SRV":
        parts = c.split()
        if len(parts) != 4:
            raise ValueError("srv must be: <prio> <weight> <port> <target>")
        prio = int(parts[0]); weight = int(parts[1]); port = int(parts[2])
        if not (0 <= prio <= 65535 and 0 <= weight <= 65535 and 0 <= port <= 65535):
            raise ValueError("srv numbers out of range")
        target = _fqdn(parts[3])
        return f"{prio} {weight} {port} {target}"
    if rtype == "CAA":
        # format: <flags> <tag> <value>
        m = re.match(r"^(\d+)\s+([a-zA-Z0-9]+)\s+(.+)$", c)
        if not m:
            raise ValueError("caa must be: <flags> <tag> <value>")
        flags = int(m.group(1))
        if flags < 0 or flags > 255:
            raise ValueError("caa flags out of range")
        tag = m.group(2)
        value = m.group(3).strip()
        if len(tag) > 32 or len(value) > 2048:
            raise ValueError("caa tag/value too long")
        return f"{flags} {tag} {value}"

    raise ValueError("unsupported record type")


def validate_rrset(*, zone_name: str, name: str, rtype: str, ttl: int, records: list[str]) -> ValidatedRRSet:
    rt = (rtype or "").strip().upper()
    if rt not in ALLOWED_TYPES:
        raise ValueError("unsupported record type")

    rn = _fqdn(name)
    _require_in_zone(rn, zone_name)

    t = _validate_ttl(int(ttl))

    if not isinstance(records, list) or len(records) == 0:
        raise ValueError("records must be a non-empty list")

    validated = [_validate_content(rt, r) for r in records]

    return ValidatedRRSet(name=rn, rtype=rt, ttl=t, records=validated)
