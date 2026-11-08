# award-finder ✈️

Findet Prämienflug-Verfügbarkeit für **Miles & More** und die **Star-Alliance-Partner** über einen ganzen
Zeitraum. Ergebnis ist ein Kalender (Datum × Kabine). Zu jedem Treffer zeigt das Tool, ob er mit M&M buchbar ist.

Die Daten kommen aus der offiziellen [seats.aero Partner API](https://developers.seats.aero/), nicht durch Scraping
von miles-and-more.com. seats.aero fragt die Programme laufend ab und speichert die Ergebnisse zwischen. Deshalb sieht man
in einem Aufruf einen ganzen Monat und mehrere Abflughäfen auf einmal.

## Abgefragte Programme

| Programm | Bedeutung für M&M-Mitglieder |
|---|---|
| `lufthansa` – Miles & More | **direkt** mit M&M buchbar |
| `united` – MileagePlus | zeigt Star-Alliance-**Partner-Saver** (LH/LX/OS/SN, NH, SQ, …) → i. d. R. auch mit M&M buchbar |
| `aeroplan` – Air Canada | ebenfalls gutes Partner-Saver-Indiz |
| `ethiopian`, `connectmiles` (Copa) | Partner-Kontingent |
| `turkish`, `singapore` | zeigen teils nur Kontingent für eigene Mitglieder → nur Indiz |

Warum das hilft: Was United oder Aeroplan für LH-, SWISS-, ANA- oder Singapore-Flüge anzeigen, ist fast immer Partner-Saver-Kontingent.
Genau dieses Kontingent kann man auch mit M&M-Meilen buchen, oft telefonisch über den Senator-Service, wenn die Website es nicht findet.

**M&M-Einschätzung**

- `M&M ✓`: direkt im M&M-Kontingent gefunden
- `M&M wahrsch.`: Partner-Saver, alle Airlines Star Alliance bzw. M&M-Partner (Discover, Edelweiss, Eurowings, Air Dolomiti)
- `M&M evtl.`: nur ein Indiz (Programm mit Eigen-Kontingent)
- `nicht M&M`: enthält eine Nicht-Partner-Airline (z. B. EK)

> ⚠️ Die Meilenpreise gelten im jeweiligen Programm. Bei M&M gilt die M&M-Prämientabelle.
> Zwischengespeicherte Daten können einige Stunden alt sein. Vor der Buchung also kurz prüfen.

## Einrichtung

1. **seats.aero Pro** abonnieren. Pro-Nutzer bekommen bis zu 1.000 API-Calls pro Tag ohne Aufpreis.
   Den API-Key gibt es unter <https://seats.aero/settings> → *API*.
2. Python ≥ 3.9. Es gibt keine weiteren Abhängigkeiten.

```bash
git clone <dieses Repo> && cd Test
pip install .            # optional, sonst: python -m award_finder ...
export SEATS_AERO_API_KEY="dein-key"
```

## Benutzung

```bash
# Business + First, Frankfurt/München nach Tokio, ganzer März
award-finder search FRA,MUC HND,NRT --from 2027-03-01 --to 2027-03-31 -c J,F

# Nur Treffer, die mit M&M buchbar sind, nonstop, mindestens 2 Plätze, inkl. Rückflug
award-finder search FRA JFK,EWR --from 2027-05-01 --to 2027-05-31 -c J --mm-only --nonstop --seats 2 --roundtrip

# Flugdetails (Flugnummern, Zeiten, Buchungsklasse, Steuern, Buchungslinks) für die 5 besten Treffer
award-finder search ZRH SFO --from 2027-06-01 --to 2027-06-30 -c J --details 5

# Liste statt Kalender, HTML-Report fürs Handy, nur SWISS/Austrian
award-finder search VIE,ZRH BKK --view list --carriers LX,OS --html report.html

# JSON für eigene Auswertungen
award-finder search FRA SIN --json > sin.json

award-finder programs      # Programme anzeigen
```

Beispielausgabe:

```
Datum          Strecke   Economy             Business            First
-------------------------------------------------------------------------------------
Di 2027-03-02  FRA-JFK   ●30k 9P M&M?        ●106k 2P M&M +1     ·
Mi 2027-03-03  FRA-JFK   ·                   ○70k 1P M&M? +1     ·
```

`●` nonstop, `○` mit Umstieg, `P` freie Plätze, `+1` heißt: ein weiteres Programm hat ebenfalls Verfügbarkeit.

### Buchungsfenster: Wann öffnet mein Reisedatum?

Business- und First-Plätze sind oft **direkt am ersten Buchungstag** am besten verfügbar. Der Befehl `window` rechnet für
jedes Programm aus, ab wann ein Abflugdatum buchbar ist. Mit `--ics` werden die Termine als Kalenderdatei gespeichert
(Erinnerung um 7 Uhr am Öffnungstag). Die Datei lässt sich in Google, Apple oder Outlook importieren.

```bash
award-finder window 2027-10-15 2027-10-29 --label "Tokio" --ics tokio.ics
```

```
Abflug Fr 15.10.2027
  Miles & More             Fenster 360 T.  öffnet 20.10.2026  bereits buchbar
  Air Canada Aeroplan      Fenster 355 T.  öffnet 25.10.2026  bereits buchbar
  United MileagePlus       Fenster 337 T.  öffnet 12.11.2026  öffnet in 4 Tagen
```

| Programm | Buchungsfenster (Richtwert) |
|---|---|
| Miles & More | ca. 360 Tage |
| Aeroplan, Turkish, KrisFlyer | ca. 355 Tage |
| United | ca. 337 Tage |

Die Programme ändern diese Werte gelegentlich. Anpassen lassen sie sich in `award_finder/alliance.py` (`window_days`).
`search` weist zusätzlich darauf hin, wenn der Suchzeitraum über das Fenster eines Programms hinausgeht.

**Tipp:** Am Öffnungstag `award-finder search … --from <Reisedatum> --to <Reisedatum>` laufen lassen. Alternativ das Datum
in `watch.json` eintragen und den cron-Job an diesen Tagen häufiger laufen lassen.

### Alarm bei neuer Verfügbarkeit

Die Suchen kommen in eine JSON-Datei (Vorlage: `watch.example.json`). Den Check dann per cron laufen lassen.
Gemeldet werden nur **neue oder günstigere** Treffer. Mit [ntfy](https://ntfy.sh) kommen sie als Push aufs Handy.

```bash
award-finder watch watch.json --state ~/.award-state.json
# crontab: alle 3 Stunden
0 */3 * * * SEATS_AERO_API_KEY=... award-finder watch ~/watch.json --state ~/.award-state.json
```

Exit-Code `10` bedeutet: neue Treffer gefunden.

## Tipps für Senatoren

- Lufthansa gibt Business/First auf Langstrecke oft erst **ca. 14 Tage vor Abflug** für Partner frei.
  M&M-Mitglieder sehen meist mehr Kontingent. Ein `watch` auf kurzfristige Daten lohnt sich.
- Wenn `M&M wahrsch.` angezeigt wird, die M&M-Website aber nichts findet: über den **Senator-Service** buchen und die
  konkreten Flugnummern und die Buchungsklasse (aus `--details`, z. B. `I` oder `O` für Business-Saver) nennen.
- Mehrere Abflughäfen kombinieren (`FRA,MUC,ZRH,VIE,BRU`). Die Zubringer innerhalb Europas sind meist leicht zu finden.

## Entwicklung

```bash
python -m unittest discover -s tests
```

Die Star-Alliance-Mitglieder und die zusätzlichen M&M-Partner stehen in `award_finder/alliance.py` und lassen sich dort anpassen.
Das Tool ist ein privates Hilfsmittel und gehört weder zu Lufthansa, Miles & More noch zu seats.aero. Die API darf laut den
Nutzungsbedingungen von seats.aero nur nicht-kommerziell genutzt werden.
