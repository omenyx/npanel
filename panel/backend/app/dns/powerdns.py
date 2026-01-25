from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.config.settings import settings


@dataclass(frozen=True)
class PDNSZone:
    id: str
    name: str
    kind: str | None


def _pdns_base() -> tuple[str, str, str]:
    if not settings.pdns_api_url or not settings.pdns_api_key:
        raise RuntimeError("PowerDNS is not configured")
    return settings.pdns_api_url.rstrip("/"), settings.pdns_api_key, settings.pdns_server_id


async def list_zones() -> list[PDNSZone]:
    base, api_key, server_id = _pdns_base()
    url = f"{base}/api/v1/servers/{server_id}/zones"

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers={"X-API-Key": api_key})
        resp.raise_for_status()
        data = resp.json()

    zones: list[PDNSZone] = []
    for z in data:
        zones.append(PDNSZone(id=str(z.get("id") or z.get("name")), name=str(z.get("name")), kind=z.get("kind")))
    return zones


async def create_zone(*, name: str, nameservers: list[str]) -> PDNSZone:
    base, api_key, server_id = _pdns_base()
    url = f"{base}/api/v1/servers/{server_id}/zones"

    payload: dict[str, Any] = {
        "name": name if name.endswith(".") else f"{name}.",
        "kind": "Native",
        "nameservers": nameservers,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, headers={"X-API-Key": api_key}, json=payload)
        resp.raise_for_status()
        z = resp.json()

    return PDNSZone(id=str(z.get("id") or z.get("name")), name=str(z.get("name")), kind=z.get("kind"))


async def patch_rrsets(*, zone_id: str, rrsets: list[dict[str, Any]]) -> None:
    base, api_key, server_id = _pdns_base()
    zid = zone_id if zone_id.endswith(".") else f"{zone_id}."
    url = f"{base}/api/v1/servers/{server_id}/zones/{zid}"

    payload = {"rrsets": rrsets}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.patch(url, headers={"X-API-Key": api_key}, json=payload)
        resp.raise_for_status()
