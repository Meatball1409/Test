"""Star Alliance / Miles & More reference data.

Stand: Ende 2026. Allianzen ändern sich – bei Bedarf hier anpassen.
"""

from __future__ import annotations

from dataclasses import dataclass

# IATA-Codes der Star-Alliance-Mitglieder.
STAR_ALLIANCE: dict[str, str] = {
    "A3": "Aegean",
    "AC": "Air Canada",
    "CA": "Air China",
    "AI": "Air India",
    "NZ": "Air New Zealand",
    "NH": "ANA",
    "OZ": "Asiana",  # Integration in Korean Air (SkyTeam) läuft – ggf. entfernen
    "OS": "Austrian",
    "AV": "Avianca",
    "SN": "Brussels Airlines",
    "CM": "Copa",
    "OU": "Croatia Airlines",
    "MS": "EgyptAir",
    "ET": "Ethiopian",
    "BR": "EVA Air",
    "LO": "LOT",
    "LH": "Lufthansa",
    "ZH": "Shenzhen Airlines",
    "SQ": "Singapore Airlines",
    "SA": "South African",
    "LX": "SWISS",
    "TP": "TAP Air Portugal",
    "TG": "Thai",
    "TK": "Turkish Airlines",
    "UA": "United",
}

# Nicht-Star-Alliance-Airlines, die trotzdem mit Miles & More als Prämie buchbar sind
# (Lufthansa Group / M&M-Partner).
MM_EXTRA_PARTNERS: dict[str, str] = {
    "EN": "Air Dolomiti",
    "4Y": "Discover Airlines",
    "WK": "Edelweiss",
    "EW": "Eurowings",
}

MM_BOOKABLE: dict[str, str] = {**STAR_ALLIANCE, **MM_EXTRA_PARTNERS}

LH_GROUP = {"LH", "LX", "OS", "SN", "EN", "4Y", "WK", "EW"}


@dataclass(frozen=True)
class Program:
    key: str
    name: str
    # "mm"      -> Miles & More selbst: direkt buchbar
    # "partner" -> zeigt Star-Alliance-Partner-Saver-Kontingent (meist auch über M&M buchbar)
    # "own"     -> zeigt v. a. Kontingent für eigene Mitglieder (nur Indiz für M&M)
    kind: str
    note: str = ""
    # Buchungsfenster in Tagen vor Abflug (Richtwert, None = unbekannt).
    # Die Programme ändern das gelegentlich – bei Bedarf hier anpassen.
    window_days: int | None = None


PROGRAMS: dict[str, Program] = {
    p.key: p
    for p in [
        Program("lufthansa", "Miles & More", "mm", "Direkt bei M&M buchbar", window_days=360),
        Program("united", "United MileagePlus", "partner", "Gutes Indiz für Partner-Saver (X/I/O)", window_days=337),
        Program("aeroplan", "Air Canada Aeroplan", "partner", "Gutes Indiz für Partner-Saver", window_days=355),
        Program("turkish", "Turkish Miles&Smiles", "own", "TK zeigt teils Eigen-Kontingent", window_days=355),
        Program("singapore", "Singapore KrisFlyer", "own", "SQ gibt Partnern weniger frei", window_days=355),
        Program("ethiopian", "Ethiopian ShebaMiles", "partner", ""),
        Program("connectmiles", "Copa ConnectMiles", "partner", ""),
    ]
}

DEFAULT_SOURCES = list(PROGRAMS)

# Rangfolge der M&M-Einschätzung (kleiner = besser)
MM_STATUS_RANK = {"direct": 0, "likely": 1, "hint": 2, "no": 3}
MM_STATUS_LABEL = {
    "direct": "M&M ✓",
    "likely": "M&M wahrsch.",
    "hint": "M&M evtl.",
    "no": "nicht M&M",
}


def parse_carriers(value: str | None) -> list[str]:
    if not value:
        return []
    return [c.strip().upper() for c in value.replace(";", ",").split(",") if c.strip()]


def mm_status(source: str, carriers: list[str], all_must_match: bool) -> str:
    """Estimate whether an award found in ``source`` can be booked with Miles & More.

    ``all_must_match`` is True for flight-level trips (every segment carrier must be
    bookable) and False for summary objects, where the airline list mixes itineraries.
    """
    if source == "lufthansa":
        return "direct"
    if not carriers:
        return "hint" if PROGRAMS.get(source, Program(source, source, "own")).kind == "partner" else "no"
    matches = [c in MM_BOOKABLE for c in carriers]
    ok = all(matches) if all_must_match else any(matches)
    if not ok:
        return "no"
    kind = PROGRAMS.get(source, Program(source, source, "own")).kind
    return "likely" if kind == "partner" else "hint"
