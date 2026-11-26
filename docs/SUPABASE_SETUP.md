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

- *Passwort vergessen:* Admin setzt unter Authentication → Users → Nutzer → „Reset password“ / neues Passwort.
- *Kollege verlässt das Team:* Nutzer löschen – alle seine Daten werden automatisch mit gelöscht.

## Gut zu wissen
- Die Trennung der Daten erzwingt der Server (Row Level Security): Jeder Nutzer kann nur seine eigenen Zeilen lesen und schreiben.
- Übertragung verschlüsselt (HTTPS), Speicherung verschlüsselt (AES-256) in Frankfurt.
- Der Projekt-Inhaber (Admin) kann im Supabase-Dashboard technisch alle Daten einsehen.
- Kostenloser Tarif: Projekte werden nach 7 Tagen ohne jede Nutzung pausiert und lassen sich im Dashboard wieder starten.
