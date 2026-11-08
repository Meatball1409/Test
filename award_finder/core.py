"""Turn seats.aero availability objects into comparable award offers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Iterable

from .alliance import MM_BOOKABLE, MM_STATUS_RANK, PROGRAMS, mm_status, parse_carriers

CABINS = {"Y": "Economy", "W": "Premium Eco", "J": "Business", "F": "First"}
CABIN_ALIASES = {
    "y": "Y", "eco": "Y", "economy": "Y",
    "w": "W", "pe": "W", "premium": "W", "premium_economy": "W",
    "j": "J", "c": "J", "biz": "J", "business": "J",
    "f": "F", "first": "F",
}
TRIP_CABIN = {"economy": "Y", "premium": "W", "business": "J", "first": "F"}


def parse_cabins(value: str | None) -> list[str]:
    if not value:
        return list(CABINS)
    out = []
    for part in value.split(","):
        key = part.strip().lower()
        if not key:
            continue
        if key not in CABIN_ALIASES:
            raise ValueError(f"Unbekannte Kabine: {part!r} (erlaubt: Y, W, J, F)")
        if CABIN_ALIASES[key] not in out:
            out.append(CABIN_ALIASES[key])
    return out


def _int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


@dataclass
class Offer:
    date: str
    origin: str
    destination: str
    source: str
    cabin: str
    miles: int
    seats: int  # 0 = unbekannt
    airlines: list[str]
    direct: bool
    availability_id: str
    updated_at: str = ""
    mm: str = "no"

    @property
    def program(self) -> str:
        p = PROGRAMS.get(self.source)
        return p.name if p else self.source

    @property
    def key(self) -> str:
        return f"{self.date}|{self.origin}-{self.destination}|{self.source}|{self.cabin}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["program"] = self.program
        return d


def offers_from_availability(av: dict) -> list[Offer]:
    route = av.get("Route") or {}
    origin = route.get("OriginAirport", "")
    dest = route.get("DestinationAirport", "")
    source = av.get("Source") or route.get("Source", "")
    out = []
    for c in CABINS:
        if not av.get(f"{c}Available"):
            continue
        airlines = parse_carriers(av.get(f"{c}Airlines"))
        out.append(
            Offer(
                date=av.get("Date", ""),
                origin=origin,
                destination=dest,
                source=source,
                cabin=c,
                miles=_int(av.get(f"{c}MileageCost")),
                seats=_int(av.get(f"{c}RemainingSeats")),
                airlines=airlines,
                direct=bool(av.get(f"{c}Direct")),
                availability_id=av.get("ID", ""),
                updated_at=av.get("UpdatedAt", ""),
                mm=mm_status(source, airlines, all_must_match=False),
            )
        )
    return out


@dataclass
class Filters:
    cabins: list[str] = field(default_factory=lambda: list(CABINS))
    direct_only: bool = False
    max_miles: int | None = None
    min_seats: int = 1
    mm_only: bool = False
    carriers: list[str] = field(default_factory=list)


def apply_filters(offers: Iterable[Offer], f: Filters) -> list[Offer]:
    res = []
    for o in offers:
        if o.cabin not in f.cabins:
            continue
        if f.direct_only and not o.direct:
            continue
        if f.max_miles and o.miles and o.miles > f.max_miles:
            continue
        # seats == 0 bedeutet "unbekannt" -> nicht wegfiltern
        if f.min_seats > 1 and o.seats and o.seats < f.min_seats:
            continue
        if f.mm_only and o.mm == "no":
            continue
        if f.carriers and not set(o.airlines) & set(f.carriers):
            continue
        res.append(o)
    return res


def sort_key(o: Offer):
    return (o.date, o.origin, o.destination, "FJWY".index(o.cabin), MM_STATUS_RANK[o.mm], o.miles or 10**9)


def best_by_cell(offers: Iterable[Offer]) -> dict[tuple[str, str, str], dict[str, Offer]]:
    """Calendar: (date, origin, dest) -> cabin -> best offer.

    Best = best M&M status first, then fewest miles.
    """
    cal: dict[tuple[str, str, str], dict[str, Offer]] = {}
    for o in offers:
        row = cal.setdefault((o.date, o.origin, o.destination), {})
        cur = row.get(o.cabin)
        if cur is None or (MM_STATUS_RANK[o.mm], o.miles or 10**9) < (MM_STATUS_RANK[cur.mm], cur.miles or 10**9):
            row[o.cabin] = o
    return dict(sorted(cal.items()))


def sources_by_cell(offers: Iterable[Offer]) -> dict[tuple[str, str, str, str], list[str]]:
    out: dict[tuple[str, str, str, str], list[str]] = {}
    for o in offers:
        lst = out.setdefault((o.date, o.origin, o.destination, o.cabin), [])
        if o.source not in lst:
            lst.append(o.source)
    return out


@dataclass
class Segment:
    flight: str
    origin: str
    destination: str
    departs: str
    arrives: str
    aircraft: str
    fare_class: str


@dataclass
class Trip:
    source: str
    cabin: str
    miles: int
    taxes: float
    taxes_currency: str
    seats: int
    stops: int
    duration_min: int
    carriers: list[str]
    flights: str
    departs: str
    arrives: str
    segments: list[Segment]
    mm: str
    mixed_cabin_pct: int = 0

    @property
    def program(self) -> str:
        p = PROGRAMS.get(self.source)
        return p.name if p else self.source


def trips_from_response(resp: dict) -> tuple[list[Trip], list[dict]]:
    trips = []
    for t in resp.get("data") or []:
        carriers = parse_carriers(t.get("Carriers"))
        segs = [
            Segment(
                flight=s.get("FlightNumber", ""),
                origin=s.get("OriginAirport", ""),
                destination=s.get("DestinationAirport", ""),
                departs=s.get("DepartsAt", ""),
                arrives=s.get("ArrivesAt", ""),
                aircraft=s.get("AircraftName") or s.get("AircraftCode", ""),
                fare_class=s.get("FareClass", ""),
            )
            for s in sorted(t.get("AvailabilitySegments") or [], key=lambda s: s.get("Order", 0))
        ]
        if not carriers:
            carriers = sorted({s.flight[:2] for s in segs if s.flight})
        source = t.get("Source", "")
        trips.append(
            Trip(
                source=source,
                cabin=TRIP_CABIN.get((t.get("Cabin") or "").lower(), "?"),
                miles=_int(t.get("MileageCost")),
                taxes=_int(t.get("TotalTaxes")) / 100.0,
                taxes_currency=t.get("TaxesCurrency") or "",
                seats=_int(t.get("RemainingSeats")),
                stops=_int(t.get("Stops")),
                duration_min=_int(t.get("TotalDuration")),
                carriers=carriers,
                flights=t.get("FlightNumbers", ""),
                departs=t.get("DepartsAt", ""),
                arrives=t.get("ArrivesAt", ""),
                segments=segs,
                mm=mm_status(source, carriers, all_must_match=True),
                mixed_cabin_pct=_int(t.get("MixedCabinPct")),
            )
        )
    trips.sort(key=lambda t: (MM_STATUS_RANK[t.mm], t.miles, t.duration_min))
    return trips, resp.get("booking_links") or []


def non_mm_carriers(carriers: Iterable[str]) -> list[str]:
    return [c for c in carriers if c not in MM_BOOKABLE]
