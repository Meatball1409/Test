"""Command line interface: ``award-finder`` / ``python -m award_finder``."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from .alliance import DEFAULT_SOURCES, MM_STATUS_LABEL, PROGRAMS
from .api import SeatsAeroClient, SeatsAeroError
from .core import Filters, Offer, apply_filters, offers_from_availability, parse_cabins, sort_key, trips_from_response
from .render import render_calendar, render_html, render_list, render_trips


def _client(args) -> SeatsAeroClient:
    return SeatsAeroClient(os.environ.get("SEATS_AERO_API_KEY", ""))


def _date_range(args) -> tuple[str, str]:
    start = args.date_from or date.today().isoformat()
    end = args.date_to or (date.fromisoformat(start) + timedelta(days=30)).isoformat()
    if end < start:
        raise SystemExit("--to liegt vor --from")
    return start, end


def _sources(value: str | None) -> list[str]:
    if not value or value == "star":
        return list(DEFAULT_SOURCES)
    if value == "alle":
        return []  # alle Programme bei seats.aero
    return [s.strip().lower() for s in value.split(",") if s.strip()]


def run_search(
    client: SeatsAeroClient,
    origin: str,
    destination: str,
    start: str,
    end: str,
    sources: list[str],
    filters: Filters,
) -> list[Offer]:
    raw = client.cached_search(
        origin,
        destination,
        start_date=start,
        end_date=end,
        sources=sources or None,
        only_direct=filters.direct_only,
    )
    offers = [o for av in raw for o in offers_from_availability(av)]
    return sorted(apply_filters(offers, filters), key=sort_key)


def _filters(args) -> Filters:
    return Filters(
        cabins=parse_cabins(args.cabin),
        direct_only=args.nonstop,
        max_miles=args.max_miles,
        min_seats=args.seats,
        mm_only=args.mm_only,
        carriers=[c.strip().upper() for c in (args.carriers or "").split(",") if c.strip()],
    )


def cmd_search(args) -> int:
    client = _client(args)
    start, end = _date_range(args)
    filters = _filters(args)
    sources = _sources(args.programs)
    legs = [(args.origin, args.destination)]
    if args.roundtrip:
        legs.append((args.destination, args.origin))

    all_offers: list[Offer] = []
    for o, d in legs:
        all_offers += run_search(client, o, d, start, end, sources, filters)

    if args.json:
        print(json.dumps([x.to_dict() for x in all_offers], ensure_ascii=False, indent=2))
    else:
        for o, d in legs:
            leg = [x for x in all_offers if x.origin in o.upper().split(",") and x.destination in d.upper().split(",")]
            print(f"\n=== {o.upper()} → {d.upper()}  ({start} bis {end}) – {len(leg)} Angebote ===\n")
            if args.view == "list":
                print(render_list(leg, limit=args.limit))
            else:
                print(render_calendar(leg, filters.cabins))

    if args.details and not args.json:
        best = sorted(all_offers, key=lambda x: (["direct", "likely", "hint", "no"].index(x.mm), x.miles or 10**9))
        seen = set()
        print("\n=== Flugdetails ===")
        for off in best:
            if len(seen) >= args.details:
                break
            if off.availability_id in seen:
                continue
            seen.add(off.availability_id)
            try:
                trips, links = trips_from_response(client.trips(off.availability_id))
            except SeatsAeroError as e:
                print(f"  {off.key}: {e}")
                continue
            print()
            print(render_trips(off, trips, links))

    if args.html:
        title = " · ".join(f"{o.upper()} → {d.upper()}" for o, d in legs)
        progs = ", ".join(PROGRAMS[s].name if s in PROGRAMS else s for s in sources) or "alle Programme"
        Path(args.html).write_text(
            render_html(all_offers, filters.cabins, f"Prämienflüge {title}", f"{start} bis {end} · {progs}"),
            encoding="utf-8",
        )
        print(f"\nHTML-Report: {args.html}", file=sys.stderr)

    print(f"\n({client.calls} API-Calls verbraucht)", file=sys.stderr)
    return 0


# ---------------------------------------------------------------- watch


def _notify(url: str, title: str, message: str) -> None:
    req = urllib.request.Request(
        url, data=message.encode("utf-8"), headers={"Title": title.encode("utf-8").decode("latin-1", "ignore")}
    )
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # Benachrichtigung darf den Lauf nicht abbrechen
        print(f"Benachrichtigung fehlgeschlagen: {e}", file=sys.stderr)


def cmd_watch(args) -> int:
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    state_path = Path(args.state)
    state: dict[str, int] = json.loads(state_path.read_text()) if state_path.exists() else {}
    client = _client(args)
    ntfy = args.ntfy or cfg.get("ntfy")
    new_state: dict[str, int] = {}
    total_new = 0

    for s in cfg.get("searches", []):
        f = Filters(
            cabins=parse_cabins(s.get("cabins")),
            direct_only=bool(s.get("nonstop")),
            max_miles=s.get("max_miles"),
            min_seats=int(s.get("seats", 1)),
            mm_only=bool(s.get("mm_only", True)),
        )
        offers = run_search(
            client, s["origin"], s["destination"], s["from"], s["to"], _sources(s.get("programs")), f
        )
        fresh = []
        for o in offers:
            new_state[o.key] = o.miles
            if o.key not in state or (o.miles and state[o.key] and o.miles < state[o.key]):
                fresh.append(o)
        name = s.get("name") or f"{s['origin']}-{s['destination']}"
        if fresh:
            total_new += len(fresh)
            lines = [
                f"{o.date} {o.origin}-{o.destination} {o.cabin} {o.miles or '?'} Meilen "
                f"({o.program}, {MM_STATUS_LABEL[o.mm]})"
                for o in fresh[:20]
            ]
            print(f"[{name}] {len(fresh)} neu:\n  " + "\n  ".join(lines))
            if ntfy:
                _notify(ntfy, f"Prämienflüge: {name}", "\n".join(lines))
        else:
            print(f"[{name}] nichts Neues ({len(offers)} bekannte Angebote)")

    state_path.write_text(json.dumps(new_state, indent=0, sort_keys=True))
    print(f"({client.calls} API-Calls verbraucht)", file=sys.stderr)
    return 0 if total_new == 0 else 10


def cmd_programs(args) -> int:
    for p in PROGRAMS.values():
        kind = {"mm": "M&M direkt", "partner": "Partner-Saver", "own": "Eigen-Kontingent"}[p.kind]
        print(f"{p.key:<13} {p.name:<24} {kind:<17} {p.note}")
    print("\nStandard: alle oben (--programs star). Mit --programs alle werden alle seats.aero-Programme abgefragt.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="award-finder",
        description="Prämienflug-Verfügbarkeit für Miles & More und Star-Alliance-Partner (via seats.aero).",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="Verfügbarkeit suchen")
    s.add_argument("origin", help="Abflughafen(s), z. B. FRA oder FRA,MUC,ZRH")
    s.add_argument("destination", help="Zielflughafen(s), z. B. JFK oder NRT,HND")
    s.add_argument("--from", dest="date_from", help="Frühestes Abflugdatum YYYY-MM-DD (Standard: heute)")
    s.add_argument("--to", dest="date_to", help="Spätestes Abflugdatum YYYY-MM-DD (Standard: +30 Tage)")
    s.add_argument("-c", "--cabin", help="Kabinen: Y,W,J,F (Standard: alle)")
    s.add_argument("-p", "--programs", help="seats.aero-Programme, z. B. lufthansa,united (Standard: star; 'alle' = alle)")
    s.add_argument("--nonstop", action="store_true", help="Nur Nonstop-Verbindungen")
    s.add_argument("--max-miles", type=int, help="Maximale Meilen pro Strecke")
    s.add_argument("--seats", type=int, default=1, help="Mindestanzahl freier Plätze (Standard 1)")
    s.add_argument("--mm-only", action="store_true", help="Nur Angebote, die (wahrscheinlich) mit M&M buchbar sind")
    s.add_argument("--carriers", help="Nur mit diesen Airlines, z. B. LH,LX,OS")
    s.add_argument("--roundtrip", action="store_true", help="Rückrichtung im selben Zeitraum mitsuchen")
    s.add_argument("--view", choices=["calendar", "list"], default="calendar", help="Ausgabe als Kalender oder Liste")
    s.add_argument("--limit", type=int, help="Max. Zeilen in der Listenansicht")
    s.add_argument("--details", type=int, default=0, metavar="N", help="Flugdetails für die N besten Treffer laden (1 API-Call je Treffer)")
    s.add_argument("--html", metavar="DATEI", help="Kalender zusätzlich als HTML-Report speichern")
    s.add_argument("--json", action="store_true", help="Rohe Treffer als JSON ausgeben")
    s.set_defaults(func=cmd_search)

    w = sub.add_parser("watch", help="Gespeicherte Suchen prüfen und bei neuen Treffern benachrichtigen (für cron)")
    w.add_argument("config", help="JSON-Datei mit Suchen (siehe watch.example.json)")
    w.add_argument("--state", default=".award-finder-state.json", help="Datei für bereits gemeldete Treffer")
    w.add_argument("--ntfy", help="ntfy.sh-URL für Push-Benachrichtigungen, z. B. https://ntfy.sh/mein-topic")
    w.set_defaults(func=cmd_watch)

    p = sub.add_parser("programs", help="Unterstützte Vielfliegerprogramme anzeigen")
    p.set_defaults(func=cmd_programs)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (SeatsAeroError, ValueError) as e:
        print(f"Fehler: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
