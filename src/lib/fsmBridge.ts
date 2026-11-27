/**
 * SAP FSM ohne eigenen Server: TechDesk läuft als „Web Container“ in der SAP-FSM-Mobile-App.
 *
 * - Die FSM-App meldet den Techniker an (Firmen-Login, verwaltet von der IT).
 * - Über die JavaScript Bridge (window.fsmHost) liefert sie den Kontext inkl. eines
 *   kurzlebigen OAuth-Tokens DIESES Technikers. Damit liest TechDesk die Query API direkt –
 *   mit genau den Rechten, die die IT dem Techniker in FSM gegeben hat.
 * - Es gibt keinen TechDesk-Server, kein TechDesk-Konto und keine gespeicherten Zugangsdaten.
 *   Das Token wird nur im Arbeitsspeicher gehalten und nie gespeichert.
 *
 * Doku: help.sap.com → SAP Field Service Management → Mobile → Web Containers / JavaScript Bridge
 */
import type { FsmActivity, FsmClient, FsmTimeEffort } from './fsm';

export interface FsmHost { postMessage(message: string): void }
interface BridgeResponse { success: boolean; requestId: string; command: string; payload?: unknown; error?: { code: string; message: string } }

export interface FsmContext {
  user: string;
  user_email?: string;
  account: string;
  account_id: string;
  selected_company_name: string;
  selected_company_id: string;
  cluster_url: string;
  access_token: string;
  expires_in?: number;
}

export class FsmBridge {
  private pending = new Map<string, { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void }>();
  private n = 0;
  constructor(private host: FsmHost, events: EventTarget, private apiKey?: string) {
    events.addEventListener('fsmHostResponse', (ev) => this.onResponse((ev as CustomEvent<BridgeResponse>).detail));
  }
  private onResponse(r: BridgeResponse | undefined) {
    const p = r && this.pending.get(r.requestId);
    if (!p || !r) return;
    this.pending.delete(r.requestId);
    if (r.success) p.resolve(r);
    else p.reject(new Error(`FSM: ${r.error?.message ?? r.error?.code ?? 'Fehler'}`));
  }
  request<T>(command: string, payload: unknown = {}, timeoutMs = 20_000): Promise<T> {
    const requestId = `td-${command}-${Date.now()}-${++this.n}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: (r) => resolve(r.payload as T), reject });
      const msg: Record<string, unknown> = { apiVersion: 1, requestId, command, payload };
      if (this.apiKey) msg.apiKey = this.apiKey;
      this.host.postMessage(JSON.stringify(msg));
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('FSM antwortet nicht (Zeitüberschreitung)')); }, timeoutMs);
    });
  }
  context() { return this.request<FsmContext>('CONTEXT_REQUEST'); }
  loggedInPerson() { return this.request<{ id: string; emailAddress?: string }>('GET_LOGGED_IN_PERSON'); }
}

/* ---------- Abfragen (Query API, nur lesend) ---------- */

const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

export const ACTIVITY_DTOS = 'Activity.43;ServiceCall.27;BusinessPartner.23;Equipment.24;Address.22';
export const EFFORT_DTOS = 'TimeEffort.16;TimeTask.18';

export function activitiesQuery(personId: string, from: string, to: string) {
  return `SELECT a.id, a.code, a.subject, a.status, a.startDateTime, a.endDateTime, sc.code, sc.subject, bp.name, e.serialNumber, e.name, ad.street, ad.zipCode, ad.city
 FROM Activity a JOIN ServiceCall sc ON a.object.objectId = sc.id LEFT JOIN BusinessPartner bp ON sc.businessPartner = bp.id
 LEFT JOIN Equipment e ON a.equipment = e.id LEFT JOIN Address ad ON a.address = ad.id
 WHERE ${q(personId)} IN a.responsibles AND a.endDateTime >= ${q(from + 'T00:00:00Z')} AND a.startDateTime <= ${q(to + 'T23:59:59Z')}`;
}
export function effortsQuery(personId: string, from: string, to: string) {
  return `SELECT te.id, te.startDateTime, te.endDateTime, te.object, tt.name FROM TimeEffort te LEFT JOIN TimeTask tt ON te.task = tt.id
 WHERE te.createPerson = ${q(personId)} AND te.startDateTime >= ${q(from + 'T00:00:00Z')} AND te.startDateTime <= ${q(to + 'T23:59:59Z')}`;
}

type Row = Record<string, Record<string, unknown> | undefined>;
const str = (v: unknown) => (v == null ? '' : String(v));

export function rowToActivity(r: Row): FsmActivity {
  const a = r.a ?? {}, sc = r.sc ?? {}, ad = r.ad ?? {}, e = r.e ?? {};
  return {
    id: str(a.id), code: str(a.code), subject: str(a.subject), status: a.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    start: str(a.startDateTime).slice(0, 16), end: str(a.endDateTime).slice(0, 16),
    serviceCall: { code: str(sc.code), subject: str(sc.subject) }, customer: str(r.bp?.name),
    address: [str(ad.street), [str(ad.zipCode), str(ad.city)].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    equipment: { serial: str(e.serialNumber), name: str(e.name) },
  };
}
export function rowToEffort(r: Row): FsmTimeEffort {
  const te = r.te ?? {}, name = str(r.tt?.name);
  return {
    id: str(te.id), activityId: str((te.object as { objectId?: string } | undefined)?.objectId),
    task: /reise|travel/i.test(name) ? 'Reisezeit' : /kunde|customer/i.test(name) ? 'Kundenbesuch' : 'Arbeitszeit',
    start: str(te.startDateTime).slice(0, 16), end: str(te.endDateTime).slice(0, 16),
  };
}

/** Live-Client: Anmeldung und Rechte kommen vollständig aus FSM (IT). */
export function bridgeClient(bridge: FsmBridge, fetchFn: typeof fetch = (...a) => fetch(...a)): FsmClient {
  let personId: string | null = null;
  async function query<T>(build: (pid: string) => string, dtos: string): Promise<T[]> {
    const ctx = await bridge.context(); // Token jedes Mal frisch holen, nie speichern
    if (!ctx?.access_token || !ctx.cluster_url) throw new Error('FSM liefert keinen Zugang – bitte in der FSM-App neu anmelden');
    personId ??= (await bridge.loggedInPerson()).id;
    const base = ctx.cluster_url.replace(/\/+$/, '');
    const url = `${base}/api/query/v1?dtos=${encodeURIComponent(dtos)}&account=${encodeURIComponent(ctx.account)}&company=${encodeURIComponent(ctx.selected_company_name)}`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `bearer ${ctx.access_token}`, 'content-type': 'application/json',
        'X-Client-ID': 'custom-techdesk', 'X-Client-Version': '1.0',
        'X-Account-ID': ctx.account_id, 'X-Company-ID': ctx.selected_company_id,
      },
      body: JSON.stringify({ query: build(personId) }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('FSM: keine Berechtigung – Rechte bitte bei der IT anfragen');
    if (!res.ok) throw new Error(`FSM-Abfrage fehlgeschlagen (${res.status})`);
    return ((await res.json()) as { data?: T[] }).data ?? [];
  }
  return {
    mode: 'live',
    activities: async (from, to) => (await query<Row>((p) => activitiesQuery(p, from, to), ACTIVITY_DTOS)).map(rowToActivity),
    timeEfforts: async (from, to) => (await query<Row>((p) => effortsQuery(p, from, to), EFFORT_DTOS)).map(rowToEffort),
    async sendReport() { throw new Error('Senden an FSM folgt in Phase 2 – nach Freigabe durch die IT. Bis dahin: Text kopieren und im FSM einfügen.'); },
  };
}

/* ---------- Laufzeit ---------- */

declare global { interface Window { fsmHost?: FsmHost } }

export const insideFsm = () => typeof window !== 'undefined' && typeof window.fsmHost?.postMessage === 'function';

let shared: FsmBridge | null = null;
export function fsmBridge(): FsmBridge | null {
  if (!insideFsm()) return null;
  shared ??= new FsmBridge(window.fsmHost!, window, import.meta.env.VITE_FSM_BRIDGE_KEY || undefined);
  return shared;
}
