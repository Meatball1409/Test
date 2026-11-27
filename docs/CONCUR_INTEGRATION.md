# TechDesk ⇄ SAP Concur – Vorschlag für die IT

## Vorgaben
- Kein TechDesk-Server. Anmeldung und Konten liegen bei der IT.
- SAP Concur ist bereits im Einsatz und bleibt führend (Einreichen, Genehmigung, Verpflegungspauschalen, Auszahlung).

## Warum eine Plattform der IT nötig ist
Die Concur-Schnittstellen (Expense v4, Receipts v4, Itinerary/Travel) brauchen Firmen-Zugangsdaten
(App-Registrierung mit Client-ID/Secret bzw. Company-Token). Diese dürfen nicht in eine App.
Bei FSM übernimmt das die FSM-App selbst – für Concur gibt es so etwas nicht.
Deshalb: Die IT betreibt die Verbindung auf **ihrer** Integrationsplattform (z. B. SAP BTP Integration Suite
oder das vorhandene API-Gateway) und stellt die kleine Schnittstelle unten bereit. Das ist kein TechDesk-Server:
Zugangsdaten, Protokollierung und Abschaltung liegen vollständig bei der IT.

```
Techniker ──Firmen-Login (SSO)──▶ Concur-Gateway der IT ──Company-Token──▶ SAP Concur
   TechDesk (statische Dateien)        prüft Benutzer, nur eigene Daten        Expense / Receipts / Itinerary
```

## Abgleich in beide Richtungen
| Richtung | Inhalt |
|---|---|
| Concur → TechDesk | in Concur gebuchte Reisen (Flug, Bahn, Hotel, Mietwagen) → Reise + Kalender |
| Concur → TechDesk | Status und Betrag der eigenen Abrechnungen (Entwurf, eingereicht, genehmigt, bezahlt, zurückgewiesen) |
| TechDesk → Concur | Reise als Abrechnung (Entwurf), Belege mit Foto, Kilometer mit Privat-PKW |
| bleibt in Concur | Einreichen, Genehmigung, Verpflegungspauschalen, Auszahlung |

Eingereichte oder genehmigte Abrechnungen ändert TechDesk nicht mehr.

## Schnittstelle des Gateways (Vorschlag)
Alle Aufrufe mit dem Firmen-Login des Technikers (Session-Cookie über SSO, `credentials: include`).
Das Gateway ermittelt den Concur-Benutzer selbst (z. B. über die E-Mail) – TechDesk sendet keine Benutzer-ID.
Bei fehlender Anmeldung: `401`, Anmeldeseite unter `{basis}/login`.

| Methode | Pfad | Inhalt | Antwort |
|---|---|---|---|
| GET | `/me/reports` | – | `[{ id, name, status, total, currency }]`, Status: `Entwurf`, `Eingereicht`, `Genehmigt`, `Bezahlt`, `Zurückgewiesen` |
| GET | `/me/itineraries?from=YYYY-MM-DD&to=YYYY-MM-DD` | – | `[{ id, name, start, end, destination, country, transport, hotel?, bookingRefs?, reportId? }]` (Zeiten lokal `YYYY-MM-DDTHH:MM`, transport `flug`/`bahn`/`auto`/`firmenwagen`) |
| POST | `/me/reports` | `{ name, start, end, comment }` | `{ id }` |
| POST / PUT | `/me/reports/{reportId}/expenses[/{id}]` | `{ date, type, amount, currency, comment, receipt? }` (receipt = Base64-JPEG) | `{ id }` |
| POST / PUT | `/me/reports/{reportId}/mileage[/{id}]` | `{ date, km, comment }` | `{ id }` |

Abbildung im Gateway (Concur): Reports → Expense Reports v4, Belege → Expenses v4 + Receipts v4
(Bild an die Ausgabe), Kilometer → Mileage-Ausgabe der Firmenrichtlinie, Reisen → Itinerary/Travel.
Die Zuordnung der TechDesk-Kategorien (Hotel, Flug, Bahn, Mietwagen, Tanken, Parken, Maut, Taxi/ÖPNV,
Bewirtung, Sonstiges) zu Concur-Ausgabearten legt die IT im Gateway fest.

## Einrichtung in TechDesk
Build-Variable `VITE_CONCUR_GATEWAY_URL` = Basisadresse des Gateways. Am einfachsten liegen TechDesk-Dateien und
Gateway unter derselben Firmen-Adresse (gleiche Anmeldung, kein CORS). Dann in TechDesk: Einstellungen → SAP Concur → Live.

## Datenschutz
- Nur eigene Reisen und Abrechnungen des angemeldeten Technikers.
- TechDesk speichert keine Concur-Zugangsdaten; Belegfotos liegen bis zum Senden nur auf dem Gerät.
- Abschalten jederzeit durch die IT (Gateway sperren).

## Demo
Einstellungen → SAP Concur → **Demo**: eine gebuchte Reise, eine bezahlte Abrechnung, eigene Belege senden – alles erfunden.
