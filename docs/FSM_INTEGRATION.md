# TechDesk ↔ SAP FSM – Anbindung ohne eigenen Server (Vorschlag für die IT)

## Vorgaben
- **Es gibt keinen TechDesk-Server.** Kein Backend, keine Datenbank, keine eigene Cloud.
- **Anmeldung und Kontoverwaltung liegen vollständig bei der IT.** TechDesk hat keine eigenen
  Benutzer, Passwörter oder Einladungen.
- FSM bleibt das führende System.

## Lösung: TechDesk als „Web Container“ in der SAP-FSM-Mobile-App
SAP sieht genau diesen Fall vor: Eine Web-App (PWA) wird in FSM unter
**Admin → Company → Web Containers** eingetragen und läuft dann *innerhalb* der FSM-App.
Mit aktivierter **JavaScript Bridge** stellt die FSM-App der Web-App den Kontext bereit.

```
                 IT verwaltet: Firmen-Login (SSO), FSM-Benutzer, Rollen, Web Container
                                          │
 Techniker ──Login──▶ SAP-FSM-Mobile-App ─┤ JavaScript Bridge (window.fsmHost)
                                          ▼
                          TechDesk (statische Dateien, im Web Container)
                             │  Token des angemeldeten Technikers (nur im Speicher)
                             ▼
                          SAP FSM Query API (nur lesend)
 Eigene Daten (Zeiten, Berichte, Reisen) bleiben lokal auf dem Gerät (IndexedDB).
```

1. Der Techniker meldet sich wie gewohnt **in der FSM-App** an (Firmen-Login, von der IT verwaltet).
2. TechDesk fragt über die Bridge `CONTEXT_REQUEST` (Cluster, Account, Company, kurzlebiges
   OAuth-Token des Technikers) und `GET_LOGGED_IN_PERSON` (FSM-Person-ID) ab.
3. Mit diesem Token liest TechDesk die Query API: **nur** Einsätze (`Activity`), bei denen der Techniker
   verantwortlich ist, und **nur** seine Zeitbuchungen (`TimeEffort`). Es gelten exakt die
   FSM-Rechte, die die IT dem Benutzer gegeben hat.
4. Das Token wird bei jedem Abgleich neu geholt und **nie gespeichert**.

### Was dadurch wegfällt
| Bisheriger Entwurf | Jetzt |
|---|---|
| TechDesk-Server (Supabase, Frankfurt) | entfällt |
| Eigene Konten, Passwörter, Einladungen | entfällt – Login nur über FSM / Firmen-SSO |
| FSM-API-Client mit Client-Secret | entfällt – kein Geheimnis in App oder Server |
| Datenablage in der Cloud | entfällt – Daten nur auf dem Gerät des Technikers |

## Was die IT bereitstellen müsste
| Punkt | Details |
|---|---|
| Hosting | TechDesk als **statische Dateien** (HTML/JS/CSS, ohne Server-Logik) auf einem Firmen-Webserver bzw. einer von der IT gewählten Ablage mit HTTPS. Für den Pilot reicht die vorhandene Test-Adresse. |
| Web Container | Admin → Company → Web Containers: Name „TechDesk“, URL, Objekttyp (z. B. Activity/Person), **JavaScript Bridge enabled** |
| Authentication Key (optional) | Wird im Web Container gesetzt und beim Build als `VITE_FSM_BRIDGE_KEY` eingetragen |
| Rechte der Techniker | Lesen: Activity, ServiceCall, BusinessPartner (Name), Address, Equipment, Person, TimeEffort, TimeTask. Schreiben: TimeEffort (anlegen/ändern), Activity (Betreff/Bemerkung, ggf. anlegen), Attachment (anlegen) – meist schon für die FSM-App vorhanden |
| Voraussetzung | FSM-Mobile-App ab Release 26.10.0 (JavaScript Bridge) |
| Test | Test-/Sandbox-Mandant, falls vorhanden |

**Im Pilot zu prüfen:** dass die Query API Aufrufe aus dem Web Container zulässt (CORS) und die
Feldnamen/DTO-Versionen des Mandanten (`src/lib/fsmBridge.ts`, Abfragen `activitiesQuery`/`effortsQuery`).

**Mit der IT abzustimmen:** ob Zeitbuchungen die Firmenpause (45 min ab 8 h) als `breakInMinutes`
enthalten sollen (derzeit wird die eingetragene Pause übertragen) und ob neue Einsätze aus TechDesk
angelegt werden dürfen.

## Außerhalb von FSM (PC-Browser)
TechDesk funktioniert weiter ohne FSM und ohne Anmeldung: alle Daten lokal auf dem Gerät,
Übertragung zwischen Geräten per Sicherungsdatei. Der FSM-Abgleich ist dort nicht verfügbar.

## Datenschutz
- Zweck: Arbeitserleichterung für den einzelnen Techniker; keine Auswertung über Mitarbeitende hinweg.
- Keine personenbezogenen Daten verlassen das Gerät Richtung Dritte; es gibt keinen TechDesk-Server.
- Abschalten jederzeit durch die IT: Web Container deaktivieren bzw. Rechte in FSM entziehen.
- Abstimmung mit Datenschutz und Betriebsrat vor dem Pilot.

## Demo-Modus
Einstellungen → SAP FSM → **Demo**: zeigt den Ablauf mit erfundenen Testdaten, ohne jeden Zugriff auf FSM.
