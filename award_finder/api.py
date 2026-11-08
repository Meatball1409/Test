"""Minimal client for the seats.aero Partner API (stdlib only).

Docs: https://developers.seats.aero/reference/getting-started-p
Auth: header ``Partner-Authorization: <API key>`` (Pro users: seats.aero/settings -> API).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Iterable

BASE_URL = "https://seats.aero/partnerapi"
USER_AGENT = "award-finder/0.1 (+personal use)"


class SeatsAeroError(RuntimeError):
    pass


def _csv(value: str | Iterable[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        items = value.split(",")
    else:
        items = list(value)
    items = [i.strip().upper() for i in items if i.strip()]
    return ",".join(items) or None


class SeatsAeroClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = BASE_URL,
        timeout: float = 30.0,
        fetch: Callable[[urllib.request.Request, float], bytes] | None = None,
    ) -> None:
        if not api_key:
            raise SeatsAeroError(
                "Kein API-Key. Setze SEATS_AERO_API_KEY (seats.aero Pro -> Settings -> API)."
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._fetch = fetch or self._default_fetch
        self.calls = 0

    @staticmethod
    def _default_fetch(req: urllib.request.Request, timeout: float) -> bytes:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict:
        clean = {}
        for k, v in (params or {}).items():
            if v is None:
                continue
            clean[k] = str(v).lower() if isinstance(v, bool) else v
        url = f"{self.base_url}/{path.lstrip('/')}"
        if clean:
            url += "?" + urllib.parse.urlencode(clean)
        req = urllib.request.Request(
            url,
            headers={
                "Partner-Authorization": self.api_key,
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        self.calls += 1
        try:
            body = self._fetch(req, self.timeout)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            if e.code in (401, 403):
                raise SeatsAeroError(f"seats.aero lehnt den API-Key ab (HTTP {e.code}). {detail}") from e
            if e.code == 429:
                raise SeatsAeroError("Tageslimit der seats.aero API erreicht (HTTP 429).") from e
            raise SeatsAeroError(f"seats.aero HTTP {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise SeatsAeroError(f"Netzwerkfehler: {e.reason}") from e
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            raise SeatsAeroError("Ungültige JSON-Antwort von seats.aero") from e

    def cached_search(
        self,
        origins: str | Iterable[str],
        destinations: str | Iterable[str],
        start_date: str | None = None,
        end_date: str | None = None,
        sources: str | Iterable[str] | None = None,
        only_direct: bool = False,
        carriers: str | Iterable[str] | None = None,
        max_results: int = 3000,
        page_size: int = 1000,
    ) -> list[dict]:
        """Cached Search with pagination; results deduplicated by ID."""
        src = None
        if sources is not None:
            src = ",".join(s.strip().lower() for s in (sources.split(",") if isinstance(sources, str) else sources) if s.strip())
        params: dict[str, Any] = {
            "origin_airport": _csv(origins),
            "destination_airport": _csv(destinations),
            "start_date": start_date,
            "end_date": end_date,
            "sources": src or None,
            "carriers": _csv(carriers),
            "only_direct_flights": only_direct or None,
            "take": max(10, min(page_size, 1000)),
        }
        seen: dict[str, dict] = {}
        skip = 0
        cursor = None
        while True:
            page_params = dict(params, skip=skip or None, cursor=cursor)
            resp = self._get("search", page_params)
            data = resp.get("data") or []
            for item in data:
                seen.setdefault(item.get("ID") or json.dumps(item, sort_keys=True), item)
            if cursor is None:
                cursor = resp.get("cursor")
            skip += len(data)
            if not resp.get("hasMore") or not data or len(seen) >= max_results:
                break
        return list(seen.values())

    def trips(self, availability_id: str) -> dict:
        return self._get(f"trips/{urllib.parse.quote(availability_id)}")
