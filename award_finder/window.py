"""Booking windows: when does award space for a travel date open in each program?"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

from .alliance import PROGRAMS


@dataclass
class Opening:
    source: str
    program: str
    travel_date: date
    window_days: int | None
    opens: date | None

    def days_until(self, today: date) -> int | None:
        return None if self.opens is None else (self.opens - today).days

    def status(self, today: date) -> str:
        if self.opens is None:
            return "Fenster unbekannt"
        if self.travel_date < today:
            return "Reisedatum vorbei"
        n = (self.opens - today).days
        if n > 1:
            return f"öffnet in {n} Tagen"
        if n == 1:
            return "öffnet morgen"
        if n == 0:
            return "öffnet HEUTE"
        return "bereits buchbar"


def openings(travel_dates: Iterable[date], sources: Iterable[str] | None = None) -> list[Opening]:
    srcs = list(sources) if sources else list(PROGRAMS)
    out = []
    for td in travel_dates:
        for s in srcs:
            p = PROGRAMS.get(s)
            days = p.window_days if p else None
            out.append(
                Opening(
                    source=s,
                    program=p.name if p else s,
                    travel_date=td,
                    window_days=days,
                    opens=td - timedelta(days=days) if days else None,
                )
            )
    out.sort(key=lambda o: (o.travel_date, o.opens or date.max))
    return out


def bookable_until(source: str, today: date) -> date | None:
    """Latest departure date currently inside the program's booking window."""
    p = PROGRAMS.get(source)
    return today + timedelta(days=p.window_days) if p and p.window_days else None


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def to_ics(items: list[Opening], label: str = "", alarm_hour: int = 7) -> str:
    """All-day events on each opening date with a reminder at ``alarm_hour`` local time."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//award-finder//Buchungsfenster//DE",
        "CALSCALE:GREGORIAN",
    ]
    for o in items:
        if o.opens is None:
            continue
        what = f" {label}" if label else ""
        summary = f"Prämienflug{what}: {o.program} öffnet für {o.travel_date:%d.%m.%Y}"
        desc = (
            f"Ab heute ist der Abflug am {o.travel_date:%d.%m.%Y} bei {o.program} buchbar "
            f"(Buchungsfenster ca. {o.window_days} Tage). Business/First ist am ersten Tag oft am besten verfügbar."
        )
        lines += [
            "BEGIN:VEVENT",
            f"UID:{o.source}-{o.travel_date:%Y%m%d}-{re.sub(r'[^A-Za-z0-9]+', '-', label).strip('-') or 'trip'}@award-finder",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{o.opens:%Y%m%d}",
            f"DTEND;VALUE=DATE:{o.opens + timedelta(days=1):%Y%m%d}",
            f"SUMMARY:{_esc(summary)}",
            f"DESCRIPTION:{_esc(desc)}",
            "TRANSP:TRANSPARENT",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_esc(summary)}",
            f"TRIGGER:PT{alarm_hour}H",
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
