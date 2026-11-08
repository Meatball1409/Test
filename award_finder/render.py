"""Terminal and HTML output."""

from __future__ import annotations

import html
import os
import sys
from datetime import date as _date
from typing import Iterable

from .alliance import MM_BOOKABLE, MM_STATUS_LABEL
from .core import CABINS, Offer, Trip, best_by_cell, sort_key, sources_by_cell

WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def _use_color(stream=sys.stdout) -> bool:
    return stream.isatty() and os.environ.get("NO_COLOR") is None


class _C:
    def __init__(self, on: bool):
        self.on = on

    def __call__(self, text: str, code: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.on else text


MM_COLOR = {"direct": "1;32", "likely": "32", "hint": "33", "no": "2"}


def fmt_miles(m: int) -> str:
    if not m:
        return "?"
    return f"{m / 1000:.1f}k".replace(".0k", "k")


def weekday(d: str) -> str:
    try:
        return WEEKDAYS[_date.fromisoformat(d).weekday()]
    except ValueError:
        return "  "


def _pad(s: str, width: int, visible: str | None = None) -> str:
    vis = visible if visible is not None else s
    return s + " " * max(0, width - len(vis))


def render_calendar(offers: list[Offer], cabins: list[str], color: bool | None = None) -> str:
    c = _C(_use_color() if color is None else color)
    cal = best_by_cell(offers)
    srcs = sources_by_cell(offers)
    if not cal:
        return "Keine Verfügbarkeit gefunden."
    cw = 20
    lines = []
    head = _pad("Datum", 15) + _pad("Strecke", 10) + "".join(_pad(CABINS[k], cw) for k in cabins)
    lines.append(c(head, "1"))
    lines.append("-" * len(head))
    for (d, o, dst), row in cal.items():
        cells = []
        for k in cabins:
            off = row.get(k)
            if not off:
                cells.append(_pad(c("·", "2"), cw, "·"))
                continue
            n_src = len(srcs.get((d, o, dst, k), []))
            nonstop = "●" if off.direct else "○"
            seats = f"{off.seats}P" if off.seats else ""
            txt = f"{nonstop}{fmt_miles(off.miles)} {seats}".rstrip()
            mark = {"direct": "M&M", "likely": "M&M?", "hint": "~", "no": "–"}[off.mm]
            vis = f"{txt} {mark}" + (f" +{n_src - 1}" if n_src > 1 else "")
            col = f"{c(txt, MM_COLOR[off.mm])} {c(mark, MM_COLOR[off.mm])}" + (
                c(f" +{n_src - 1}", "2") if n_src > 1 else ""
            )
            cells.append(_pad(col, cw, vis))
        lines.append(_pad(f"{weekday(d)} {d}", 15) + _pad(f"{o}-{dst}", 10) + "".join(cells))
    lines.append("")
    lines.append(
        c(
            "● nonstop  ○ mit Umstieg  P = freie Plätze  M&M = Miles & More direkt  "
            "M&M? = Partner-Saver, i. d. R. mit M&M buchbar  ~ = nur Indiz  – = nicht M&M  +n = weitere Programme\n"
            "Meilenpreise gelten im jeweiligen Programm – bei M&M gilt die eigene Prämientabelle.",
            "2",
        )
    )
    return "\n".join(lines)


def render_list(offers: list[Offer], color: bool | None = None, limit: int | None = None) -> str:
    c = _C(_use_color() if color is None else color)
    if not offers:
        return "Keine Verfügbarkeit gefunden."
    rows = sorted(offers, key=sort_key)
    if limit:
        rows = rows[:limit]
    hdr = f"{'Datum':<14} {'Strecke':<9} {'Kab.':<5} {'Meilen':>8} {'Pl.':>3}  {'NS':<3} {'Airlines':<16} {'Programm':<22} M&M"
    out = [c(hdr, "1"), "-" * len(hdr)]
    for o in rows:
        line = (
            f"{weekday(o.date)} {o.date:<11} {o.origin + '-' + o.destination:<9} {o.cabin:<5} "
            f"{o.miles if o.miles else '?':>8} {o.seats or '?':>3}  {'ja' if o.direct else '':<3} "
            f"{', '.join(o.airlines)[:16]:<16} {o.program[:22]:<22} "
        )
        out.append(line + c(MM_STATUS_LABEL[o.mm], MM_COLOR[o.mm]))
    return "\n".join(out)


def _hhmm(ts: str) -> str:
    # seats.aero liefert lokale Zeiten mit "Z"-Suffix
    return ts[11:16] if len(ts) >= 16 else ts


def render_trips(offer: Offer, trips: list[Trip], links: list[dict], color: bool | None = None) -> str:
    c = _C(_use_color() if color is None else color)
    head = f"{offer.date} {offer.origin}-{offer.destination} · {offer.program}"
    out = [c(head, "1")]
    shown = [t for t in trips if t.cabin == offer.cabin] or trips
    if not shown:
        out.append("  (keine Flugdetails verfügbar)")
    for t in shown:
        taxes = f"{t.taxes:.2f} {t.taxes_currency}".strip() if t.taxes else "?"
        dur = f"{t.duration_min // 60}h{t.duration_min % 60:02d}" if t.duration_min else "?"
        bad = [cr for cr in t.carriers if cr not in MM_BOOKABLE]
        status = MM_STATUS_LABEL[t.mm] + (f" ({', '.join(bad)})" if bad else "")
        mixed = f" · {t.mixed_cabin_pct}% tiefere Kabine" if t.mixed_cabin_pct else ""
        out.append(
            f"  {CABINS.get(t.cabin, t.cabin):<11} {t.miles:>7} Meilen + {taxes:<12} "
            f"{t.seats or '?'} Pl. · {dur} · {t.stops} Stopp(s){mixed} · " + c(status, MM_COLOR[t.mm])
        )
        for s in t.segments:
            fc = f" [{s.fare_class}]" if s.fare_class else ""
            out.append(
                c(
                    f"      {s.flight:<7} {s.origin}->{s.destination} {_hhmm(s.departs)}–{_hhmm(s.arrives)} {s.aircraft}{fc}",
                    "2",
                )
            )
    for link in links:
        out.append(c(f"  → {link.get('label', 'Buchen')}: {link.get('link', '')}", "36"))
    return "\n".join(out)


# ---------------------------------------------------------------- HTML

_CSS = """
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e3e2dd;
--mm:#0b6b3a;--mmbg:#d9f2e3;--likely:#2f7d4f;--likelybg:#eaf6ee;--hint:#8a5a00;--hintbg:#fdf1d6;
--no:#8b8b85;--nobg:#f0efeb;--accent:#0a1f44}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141414;--fg:#ecebe6;--muted:#9a9a94;
--card:#1d1d1c;--line:#33332f;--mm:#7ee0a6;--mmbg:#123522;--likely:#9fd8b3;--likelybg:#17291e;
--hint:#f0c060;--hintbg:#33280f;--no:#77776f;--nobg:#222220;--accent:#9db8ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px 16px}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 20px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:640px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--card)}
td.cell span{display:inline-block;padding:3px 8px;border-radius:6px;font-variant-numeric:tabular-nums}
.direct{background:var(--mmbg);color:var(--mm);font-weight:600}.likely{background:var(--likelybg);color:var(--likely)}
.hint{background:var(--hintbg);color:var(--hint)}.no{background:var(--nobg);color:var(--no)}
td.empty{color:var(--line)}.we{color:var(--accent);font-weight:600}small{color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0;font-size:13px}.legend span{padding:3px 8px;border-radius:6px}
"""


def render_html(offers: list[Offer], cabins: list[str], title: str, subtitle: str) -> str:
    cal = best_by_cell(offers)
    srcs = sources_by_cell(offers)
    e = html.escape
    rows = []
    for (d, o, dst), row in cal.items():
        wd = weekday(d)
        cells = []
        for k in cabins:
            off = row.get(k)
            if not off:
                cells.append('<td class="empty">·</td>')
                continue
            others = [s for s in srcs.get((d, o, dst, k), []) if s != off.source]
            tip = (
                f"{off.program} · {', '.join(off.airlines)} · {'nonstop' if off.direct else 'mit Umstieg'}"
                + (f" · auch: {', '.join(others)}" if others else "")
            )
            seats = f" · {off.seats}P" if off.seats else ""
            cells.append(
                f'<td class="cell" title="{e(tip)}"><span class="{off.mm}">{"●" if off.direct else "○"} '
                f"{e(fmt_miles(off.miles))}{e(seats)}</span><br><small>{e(off.program)}</small></td>"
            )
        cls = ' class="we"' if wd in ("Sa", "So") else ""
        rows.append(f"<tr><td{cls}>{wd} {e(d)}</td><td>{e(o)}–{e(dst)}</td>{''.join(cells)}</tr>")
    head = "".join(f"<th>{e(CABINS[k])}</th>" for k in cabins)
    body = "".join(rows) or f'<tr><td colspan="{2 + len(cabins)}">Keine Verfügbarkeit gefunden.</td></tr>'
    legend = "".join(
        f'<span class="{k}">{e(v)}</span>' for k, v in MM_STATUS_LABEL.items()
    )
    return f"""<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title><style>{_CSS}</style></head>
<body><main><h1>{e(title)}</h1><p class="sub">{e(subtitle)}</p>
<div class="legend">{legend}<span>● nonstop · ○ Umstieg</span></div>
<div class="wrap"><table><thead><tr><th>Datum</th><th>Strecke</th>{head}</tr></thead><tbody>{body}</tbody></table></div>
<p class="sub" style="margin-top:16px">Daten: seats.aero (zwischengespeichert, kann veraltet sein). Vor der Buchung bei Miles &amp; More prüfen.</p>
</main></body></html>"""
