# TechDesk: Server einrichten (Supabase)

Einmalig, ca. 10 Minuten. Danach hat jeder Servicetechniker einen eigenen, geschützten Bereich.

## 1. Projekt anlegen
1. https://supabase.com öffnen → **Start your project** → mit GitHub oder E-Mail registrieren.
2. **New project**
   - Name: `techdesk`
   - Database Password: ein starkes Passwort erzeugen und sicher aufbewahren (wird von der App nicht gebraucht)
   - Region: **Central EU (Frankfurt)**
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

## 2. Datenbank-Tabelle mit Zugriffsschutz anlegen
1. Links **SQL Editor** → **New query**.
2. Den kompletten Inhalt von [`supabase/schema.sql`](../supabase/schema.sql) einfügen → **Run**.
3. Es sollte „Success. No rows returned“ erscheinen.

## 3. Selbst-Registrierung abschalten (nur auf Einladung)
**Authentication → Sign In / Providers** → unter *User Signups* **„Allow new users to sign up“ ausschalten** → Save.

## 4. Werte an die App übergeben
**Project Settings → API Keys** (bzw. *Data API*):
- **Project URL**, z. B. `https://abcdxyz.supabase.co`
- **anon / publishable key** (beginnt mit `eyJ…` oder `sb_publishable_…`)

Diese beiden Werte sind öffentlich und dürfen in die App. Sie werden in `src/config.ts` eingetragen
(oder als GitHub-Repository-Variablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`).

> ⚠️ Den **service_role / secret key** und das Datenbank-Passwort niemals weitergeben oder in die App eintragen.

## 5. Kollegen einladen (Admin)
**Authentication → Users → Add user → Create new user**
- E-Mail des Kollegen, ein Startpasswort (mind. 10 Zeichen)
- **„Auto Confirm User“ anhaken**

Startpasswort persönlich mitteilen. Der Kollege meldet sich an und ändert es unter
**Einstellungen → Mein Konto → Passwort ändern**.

- Bei der **ersten Anmeldung** zeigt die App dem Kollegen einen **Wiederherstellungscode**. Er muss ihn sicher aufbewahren (z. B. Passwort-Manager).
- *Passwort vergessen:* Admin setzt im Dashboard ein neues Passwort. Der Kollege meldet sich damit an und gibt seinen **Wiederherstellungscode** ein – danach ist alles wieder da. **Ohne Code sind seine bisherigen Daten nicht mehr lesbar** (er kann dann mit einem leeren Bereich neu beginnen).
- *Kollege verlässt das Team:* Nutzer löschen – alle seine Daten werden automatisch mit gelöscht.

## Gut zu wissen
- **Ende-zu-Ende-Verschlüsselung:** Die App verschlüsselt jeden Datensatz auf dem Gerät (AES-256-GCM), bevor er hochgeladen wird. Der Schlüssel ist mit dem Passwort des Nutzers gesichert (PBKDF2, 600.000 Runden). Auf dem Server liegt nur Geheimtext – **auch der Admin kann im Dashboard keine Inhalte lesen.**
- Sichtbar für den Admin sind nur: E-Mail-Adressen der Nutzer, Anzahl der Einträge pro Bereich (z. B. „12 Zeiteinträge“) und wann sie geändert wurden.
- Der Server lehnt unverschlüsselte Daten ab (CHECK-Regel) und trennt die Nutzer zusätzlich per Row Level Security.
- Wer die App-Quelltexte ändern und veröffentlichen kann, könnte theoretisch eine manipulierte Version ausliefern – deshalb Änderungen nur über geprüfte Pull Requests.
- Kostenloser Tarif: Projekte werden nach 7 Tagen ohne jede Nutzung pausiert und lassen sich im Dashboard wieder starten.
