# TechDesk – App für Servicetechniker

Eine App für Handy **und** PC (Progressive Web App): Kalender, Serviceberichte, FSM-Textbausteine,
Präsentationen, Reiseplanung und Zeiterfassung mit Überstundenberechnung. Funktioniert **offline**
(z. B. in der Produktionshalle ohne Netz) und speichert alle Daten lokal auf dem Gerät.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Heute** | Wochenstunden, Überstundenkonto, Stempeluhr (Start/Stopp), nächste Termine, Schnellzugriff |
| **Kalender** | Monatsansicht mit KW, Feiertage nach Bundesland, Termin-Typen (Einsatz, Reise, Remote, Schulung, Bereitschaft, Urlaub …), Import/Export `.ics` (Outlook, Google, Apple), aus Einsatz direkt Bericht anlegen |
| **Zeit** | Arbeit/Reise/Bereitschaft/Urlaub/Krank/Gleittag, Soll/Ist/Saldo pro Tag & Monat, Überstundenkonto, Resturlaub, automatische Mindestpause (§4 ArbZG), Warnungen bei > 10 h, Ruhezeit < 11 h, Sonn-/Feiertagsarbeit, CSV-Export für Excel |
| **Berichte** | Feste Struktur (General information → Initial situation → Findings → Recommendations → Conclusion), Live-Vorschau des **FSM-Texts** (reiner Text, fehlende Angaben als `[___]`), **Kunden-PDF** (Drucken → Als PDF speichern), **PowerPoint**-Export, Textbausteine einfügen, Autospeichern |
| **FSM-Texte** | Vorlagen mit Platzhaltern `{{Kunde}}` / `{{Menge\|1}}`, ausfüllen → kopieren → im FSM einfügen, Favoriten, Kategorien, **mit Kollegen teilen** (Export/Import) |
| **Reisen** | Reisedaten, Hotel/Buchungen, Links (Route, Hotels, Restaurants, Tankstellen, Wetter, Reisehinweise), Packliste, Belege, **Verpflegungspauschalen** inkl. Kürzung für gestellte Mahlzeiten, km-Pauschale, Abrechnung kopieren, CSV, in Kalender eintragen |
| **Einstellungen** | Bundesland, Wochenstunden, Arbeitstage, Reisezeit-/Bereitschafts-Anrechnung, Überstunden-Übertrag, Pauschalen, Logo/Firmenname, **Sicherung** (Backup/Restore, Übertragung Handy ↔ PC) |

## Installation auf dem Handy / PC

1. App-Link im Browser öffnen (Chrome, Edge oder Safari).
2. **Android/Chrome:** Menü ⋮ → „App installieren“ / „Zum Startbildschirm“.
   **iPhone/Safari:** Teilen-Symbol → „Zum Home-Bildschirm“.
   **PC (Chrome/Edge):** Installations-Symbol in der Adressleiste.
3. Danach startet TechDesk wie eine normale App – auch ohne Internet.

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Unit-Tests (Arbeitszeit, Feiertage, Pauschalen, FSM-Text, ICS)
npm run build    # Produktions-Build nach dist/
```

Tech-Stack: React 18 + TypeScript + Vite, IndexedDB (Dexie) für lokale Daten, Workbox (Offline/PWA),
pptxgenjs für PowerPoint. Deployment über GitHub Actions auf GitHub Pages (`.github/workflows/deploy.yml`).

### Projektstruktur

```
src/lib/      Fachlogik ohne UI (getestet): time, holidays, travel, report, pptx, ics, templates
src/pages/    Seiten: Home, Calendar, Time, Reports, Snippets, Trips, Settings
src/db.ts     Lokale Datenbank, Backup/Restore
```

## Logo einbinden

Das offizielle Logo wird automatisch in App, Kunden-PDF und PowerPoint verwendet, sobald die Datei
`src/assets/multivac_logo.png` existiert. Ohne Datei erscheint der Schriftzug aus den Einstellungen.

```bash
python3 scripts/prepare_logo.py pfad/zum/logo.png   # macht Weiß transparent, schneidet zu, speichert die Datei
```

Alternativ kann jeder Nutzer in den Einstellungen ein eigenes Logo hochladen (hat Vorrang).

## Persönliche Konten (Login)

Jeder Servicetechniker meldet sich mit E-Mail und Passwort an und hat einen eigenen, geschützten Bereich.
Die Daten werden zwischen Handy und PC abgeglichen, die App funktioniert weiter offline.
Beim Abmelden werden die Daten vom Gerät entfernt. Zugang nur auf Einladung durch den Admin.

Einrichtung des Servers: [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). Solange kein Server
eingetragen ist (`src/config.ts`), läuft die App ohne Anmeldung nur lokal auf dem Gerät.

## Wichtige Hinweise

- **Arbeitszeit-Regeln** (Reisezeit-Anrechnung, Bereitschaft, Pausen) sind in den Einstellungen anpassbar –
  maßgeblich sind Arbeitsvertrag und Betriebsvereinbarung.
- **Reisekosten:** Voreingestellt sind die steuerlichen Pauschalen Deutschland (28 € / 14 €, 0,30 €/km).
  Für Auslandsreisen den Länderwert aus der BMF-Tabelle eintragen. Die Firmen-Reisekostenrichtlinie hat Vorrang.
- **Datenschutz:** Kundendaten bleiben auf dem Gerät. Regelmäßig eine Sicherung erstellen.
  Keine Passwörter oder vertraulichen Zugangsdaten in Notizen speichern.

## Roadmap (nächste Ausbaustufen)

- [ ] Team-Sync (gemeinsame Vorlagen & Kalender) über ein Backend, z. B. Supabase/Firebase oder SharePoint
- [ ] Fotos im Servicebericht (Kamera) und in der Kunden-PDF
- [ ] Spracheingabe für Berichte (Diktat)
- [ ] Belege fotografieren (Spesen)
- [ ] Auslandspauschalen-Tabelle hinterlegen
- [ ] Monatsbericht Zeiterfassung als PDF
