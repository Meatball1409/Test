# TechDesk ↔ SAP FSM – Anbindung (Vorschlag für die IT)

## Ziel
Servicetechniker sehen ihre FSM-Einsätze im TechDesk-Kalender, gebuchte Zeiten fließen in die
persönliche Zeitübersicht, Berichte starten vorausgefüllt (Kunde, Maschine, Einsatz) und können
als Text/PDF an den Einsatz zurückgegeben werden. FSM bleibt das führende System.

## Architektur
```
Handy/PC (TechDesk-App)  ──HTTPS + Login-Token──▶  TechDesk-Server (Edge Function, EU)  ──OAuth2──▶  SAP FSM API
       nur eigene Daten                                hält FSM-Zugang, filtert pro Person            Query API / Data API
```
- Die App enthält **keine** FSM-Zugangsdaten. Client-ID/Secret liegen nur als Secret auf dem Server.
- Der Server prüft die Anmeldung und ermittelt die FSM-Person über die E-Mail. Er liefert **nur** Einsätze
  (`Activity` mit dem Techniker als Verantwortlichem) und **nur** dessen Zeitbuchungen (`TimeEffort`).
- Lesend über die Query API (CoreSQL); Schreiben (Bericht) erst nach gesonderter Freigabe.
- TechDesk-Daten sind Ende-zu-Ende verschlüsselt (AES-256-GCM, Schlüssel nur beim Nutzer),
  Server in Frankfurt, Row Level Security pro Nutzer.

## Was die IT bereitstellen müsste
| Punkt | Details |
|---|---|
| OAuth-Client | Grant `client_credentials`, eigene Berechtigungsgruppe |
| Leserechte | Activity, ServiceCall, BusinessPartner (Name), Address, Equipment, Person (E-Mail → ID), TimeEffort, TimeTask |
| Schreibrechte (optional, Phase 2) | Notiz/Anhang am Activity bzw. Service-Bericht |
| Angaben | Rechenzentrum (z. B. `eu.fsm.cloud.sap`), Account-ID, Company-ID |
| Test | Zugang zu einem Test-/Sandbox-Mandanten, wenn vorhanden |

## Datenschutz
- Zweck: Arbeitserleichterung für den einzelnen Techniker; keine Auswertung über Mitarbeitende hinweg.
- Jeder sieht nur eigene Daten; der Server speichert keine FSM-Daten dauerhaft (Durchreichen).
- Zeitdaten: Abstimmung mit Datenschutz und Betriebsrat (§ 87 Abs. 1 Nr. 6 BetrVG) vor dem Livegang.

## Stufen
1. **Demo** (jetzt): Demo-Modus in der App mit Testdaten.
2. **Lesen** (nach Freigabe): Einsätze → Kalender, Zeiten → Zeitübersicht, Berichtskopf vorausfüllen.
3. **Schreiben** (optional): Bericht als Text/PDF an den Einsatz.

Code: `supabase/functions/fsm/index.ts` (Entwurf, Feldnamen mit FSM-Admin abzustimmen), `src/fsmSync.ts`, `src/lib/fsm.ts`.
