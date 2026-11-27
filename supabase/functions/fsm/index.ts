// TechDesk ↔ SAP Field Service Management – Server-Baustein (Supabase Edge Function, Deno)
//
// Zweck: Die App bekommt NIE FSM-Zugangsdaten. Diese Funktion
//   1. prüft die TechDesk-Anmeldung (Supabase-JWT),
//   2. holt mit dem FSM-API-Client (OAuth2 client_credentials) ein Token,
//   3. ermittelt die FSM-Person zur E-Mail des angemeldeten Technikers,
//   4. liefert NUR dessen Einsätze und Zeitbuchungen bzw. schreibt seinen Bericht.
//
// Benötigte Secrets (von der IT, gesetzt mit `supabase secrets set …`):
//   FSM_BASE_URL       z. B. https://eu.fsm.cloud.sap   (Rechenzentrum laut IT)
//   FSM_CLIENT_ID      OAuth-Client (Berechtigungsgruppe nur mit den unten genannten Objekten)
//   FSM_CLIENT_SECRET
//   FSM_ACCOUNT_ID, FSM_COMPANY_ID
//
// STATUS: Entwurf. Feldnamen der Abfragen sind mit dem FSM-Administrator abzustimmen
// (Datenmodell/DTO-Versionen des Mandanten). Siehe docs/FSM_INTEGRATION.md.

import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const FSM = env('FSM_BASE_URL');
const HEADERS = () => ({
  'X-Account-ID': env('FSM_ACCOUNT_ID'),
  'X-Company-ID': env('FSM_COMPANY_ID'),
  'X-Client-ID': 'custom-techdesk',
  'X-Client-Version': '1.0',
});
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

let token: { value: string; until: number } | null = null;
async function fsmToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const res = await fetch(`${FSM}/api/oauth2/v2/token`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(`${env('FSM_CLIENT_ID')}:${env('FSM_CLIENT_SECRET')}`), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`FSM-Token: ${res.status}`);
  const t = await res.json();
  token = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
  return token.value;
}

/** Nur lesende Abfrage (Query API, CoreSQL) */
async function query<T>(coreSql: string, dtos: string): Promise<T[]> {
  const res = await fetch(`${FSM}/api/query/v1?dtos=${encodeURIComponent(dtos)}`, {
    method: 'POST',
    headers: { ...HEADERS(), authorization: `Bearer ${await fsmToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: coreSql }),
  });
  if (!res.ok) throw new Error(`FSM-Query: ${res.status} ${await res.text()}`);
  return (await res.json()).data ?? [];
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`; // Werte sicher einsetzen

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    // 1. TechDesk-Anmeldung prüfen
    const supa = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { authorization: req.headers.get('authorization') ?? '' } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user?.email) return json({ error: 'Nicht angemeldet' }, 401);

    // 2. FSM-Person zur E-Mail (nur der angemeldete Techniker)
    const persons = await query<{ p: { id: string } }>(`SELECT p.id FROM Person p WHERE p.emailAddress = ${q(user.email)}`, 'Person.24');
    const personId = persons[0]?.p?.id;
    if (!personId) return json({ error: 'Keine FSM-Person zu dieser E-Mail' }, 403);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/fsm/, '');
    const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) === false && req.method === 'GET') return json({ error: 'from/to fehlen' }, 400);

    if (path === '/activities') {
      const rows = await query<Record<string, Record<string, unknown>>>(
        `SELECT a.id, a.code, a.subject, a.status, a.startDateTime, a.endDateTime, sc.code, sc.subject, bp.name, e.serialNumber, e.name, ad.street, ad.zipCode, ad.city
         FROM Activity a JOIN ServiceCall sc ON a.object.objectId = sc.id LEFT JOIN BusinessPartner bp ON sc.businessPartner = bp.id
         LEFT JOIN Equipment e ON a.equipment = e.id LEFT JOIN Address ad ON a.address = ad.id
         WHERE ${q(personId)} IN a.responsibles AND a.endDateTime >= ${q(from + 'T00:00:00Z')} AND a.startDateTime <= ${q(to + 'T23:59:59Z')}`,
        'Activity.43;ServiceCall.27;BusinessPartner.23;Equipment.24;Address.22');
      return json(rows.map((r) => ({
        id: r.a.id, code: r.a.code, subject: r.a.subject, status: r.a.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
        start: String(r.a.startDateTime).slice(0, 16), end: String(r.a.endDateTime).slice(0, 16),
        serviceCall: { code: r.sc?.code, subject: r.sc?.subject }, customer: r.bp?.name ?? '',
        address: [r.ad?.street, [r.ad?.zipCode, r.ad?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        equipment: { serial: r.e?.serialNumber ?? '', name: r.e?.name ?? '' },
      })));
    }

    if (path === '/time-efforts') {
      const rows = await query<Record<string, Record<string, unknown>>>(
        `SELECT te.id, te.startDateTime, te.endDateTime, te.object, tt.name FROM TimeEffort te LEFT JOIN TimeTask tt ON te.task = tt.id
         WHERE te.createPerson = ${q(personId)} AND te.startDateTime >= ${q(from + 'T00:00:00Z')} AND te.startDateTime <= ${q(to + 'T23:59:59Z')}`,
        'TimeEffort.16;TimeTask.18');
      return json(rows.map((r) => ({
        id: r.te.id, activityId: (r.te.object as { objectId?: string })?.objectId ?? '',
        task: /reise|travel/i.test(String(r.tt?.name)) ? 'Reisezeit' : /kunde|customer/i.test(String(r.tt?.name)) ? 'Kundenbesuch' : 'Arbeitszeit',
        start: String(r.te.startDateTime).slice(0, 16), end: String(r.te.endDateTime).slice(0, 16),
      })));
    }

    if (path === '/report' && req.method === 'POST') {
      // Schreibender Zugriff nur nach Freigabe: Berichtstext als Notiz/Anhang am Einsatz.
      // Umsetzung (Objekt, Feld, Anhang) wird mit dem FSM-Administrator festgelegt.
      return json({ error: 'Schreiben an FSM noch nicht freigegeben' }, 501);
    }
    return json({ error: 'Unbekannter Pfad' }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
