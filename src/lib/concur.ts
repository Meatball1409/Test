/**
 * SAP Concur ⇄ TechDesk – ohne TechDesk-Server.
 *
 * Concur verlangt für seine Schnittstelle Firmen-Zugangsdaten (Client-ID/Secret), die nicht in eine App gehören.
 * Deshalb betreibt die IT die Verbindung auf ihrer eigenen Integrationsplattform (z. B. SAP BTP / Integration Suite)
 * und stellt dort eine kleine Schnittstelle bereit („Concur-Gateway“). TechDesk ruft sie mit dem Firmen-Login des
 * Technikers auf; die Plattform greift nur auf dessen eigene Concur-Daten zu. Vertrag: docs/CONCUR_INTEGRATION.md
 *
 * Richtung TechDesk → Concur: Reise als Spesenabrechnung (Report), gescannte Belege als PDF, Kilometer (Privat-PKW).
 * Richtung Concur → TechDesk: Status/Betrag der Abrechnung, in Concur gebuchte Reisen (Flug, Hotel, Mietwagen).
 * Verpflegungspauschalen berechnet Concur selbst nach Firmenrichtlinie – TechDesk sendet sie nicht.
 */
import { DEFAULT_CHECKLIST } from './travel';
import type { CalendarEvent, ConcurStatus, Expense, Trip } from './types';
import { uid } from './dates';
import { bytesToBase64, receiptPdf } from './pdf';

export interface ConcurReport { id: string; name: string; status: ConcurStatus; total: number; currency: string }
export interface ConcurItinerary {
  id: string; name: string;
  start: string; end: string; // lokal 'YYYY-MM-DDTHH:MM'
  destination: string; country: string;
  transport: Trip['transport'];
  hotel?: string; bookingRefs?: string;
  reportId?: string; // falls die Abrechnung in Concur schon mit der Reise verknüpft ist
}
export interface ConcurNewReport { name: string; start: string; end: string; comment: string }
export interface ConcurExpenseWrite { id?: string; reportId: string; date: string; type: string; amount: number; currency: string; comment: string; receipt?: string /* Base64 */; receiptType?: 'application/pdf' }
export interface ConcurMileageWrite { id?: string; reportId: string; date: string; km: number; comment: string }

export interface ConcurClient {
  mode: 'demo' | 'live';
  reports(): Promise<ConcurReport[]>;
  itineraries(from: string, to: string): Promise<ConcurItinerary[]>;
  createReport(r: ConcurNewReport): Promise<string>;
  saveExpense(e: ConcurExpenseWrite): Promise<string>;
  saveMileage(m: ConcurMileageWrite): Promise<string>;
}

export class ConcurLoginError extends Error {
  constructor(public loginUrl: string) { super('Bitte mit dem Firmen-Login anmelden'); }
}

/* ---------- Abgleich-Regeln (rein) ---------- */

/** Belegseiten einer Ausgabe (Scan oder älteres Einzelfoto) */
export const pagesOf = (e: Expense): string[] => e.receiptPages?.length ? e.receiptPages : e.receipt ? [e.receipt] : [];
/** Kurzer Fingerabdruck – die Bilder selbst werden nicht verglichen, nur ob/welche */
const fp = (pages: string[]) => pages.map((s) => `${s.length}:${s.slice(-24)}`).join('|');
export const hashExpense = (e: Expense) => JSON.stringify([e.date, e.category, Number(e.amount) || 0, e.note ?? '', fp(pagesOf(e))]);
/** Beleg als PDF (Base64) für Concur */
export function receiptPdfBase64(e: Expense): string | undefined {
  const pages = pagesOf(e);
  return pages.length ? bytesToBase64(receiptPdf(pages, `Beleg ${e.date} ${e.category}`)) : undefined;
}
export const hashMileage = (t: Trip) => JSON.stringify([t.km, t.departure.slice(0, 10)]);
export const editable = (t: Trip) => !t.concur?.status || t.concur.status === 'Entwurf' || t.concur.status === 'Zurückgewiesen';

export type ConcurOp =
  | { kind: 'report'; write: ConcurNewReport }
  | { kind: 'expense'; expenseId: string; write: Omit<ConcurExpenseWrite, 'reportId'>; hash: string }
  | { kind: 'mileage'; write: Omit<ConcurMileageWrite, 'reportId'>; hash: string };

/** Was muss für diese Reise an Concur? (leer, wenn alles übertragen oder die Abrechnung schon eingereicht ist) */
export function planTripPush(t: Trip): ConcurOp[] {
  if (!editable(t)) return [];
  const ops: ConcurOp[] = [];
  const label = t.title || `Reise ${t.destination}`;
  for (const e of t.expenses) {
    if (!(Number(e.amount) > 0)) continue;
    const h = hashExpense(e);
    if (e.concur?.hash === h) continue;
    ops.push({ kind: 'expense', expenseId: e.id, hash: h, write: { id: e.concur?.id, date: e.date, type: e.category, amount: Number(e.amount), currency: 'EUR', comment: [e.note, t.customer && `Kunde: ${t.customer}`].filter(Boolean).join(' · '), ...(pagesOf(e).length ? { receipt: receiptPdfBase64(e), receiptType: 'application/pdf' as const } : {}) } });
  }
  if (t.transport === 'auto' && t.km > 0) {
    const h = hashMileage(t);
    if (t.concur?.mileage?.hash !== h) ops.push({ kind: 'mileage', hash: h, write: { id: t.concur?.mileage?.id, date: t.departure.slice(0, 10), km: t.km, comment: `${label}${t.destination ? ` – ${t.destination}` : ''}` } });
  }
  if (ops.length && !t.concur?.reportId) ops.unshift({ kind: 'report', write: { name: label, start: t.departure.slice(0, 10), end: t.return.slice(0, 10), comment: [t.customer && `Kunde: ${t.customer}`, t.destination].filter(Boolean).join(' · ') } });
  return ops;
}

/** Ergebnis einer gesendeten Operation in die Reise übernehmen */
export function applyOp(t: Trip, op: ConcurOp, id: string, now: string): Trip {
  const concur = { ...t.concur, syncedAt: now };
  if (op.kind === 'report') return { ...t, concur: { ...concur, reportId: id, status: 'Entwurf' } };
  if (op.kind === 'mileage') return { ...t, concur: { ...concur, mileage: { id, hash: op.hash } } };
  return { ...t, concur, expenses: t.expenses.map((e) => (e.id === op.expenseId ? { ...e, concur: { id, hash: op.hash } } : e)) };
}

export interface ConcurPull { put: Trip[]; events: CalendarEvent[] }

/** Stand aus Concur: Abrechnungsstatus und gebuchte Reisen */
export function planPull(trips: Trip[], reports: ConcurReport[], itins: ConcurItinerary[], now: string): ConcurPull {
  const byReport = new Map(reports.map((r) => [r.id, r]));
  const put = new Map<string, Trip>();
  const events: CalendarEvent[] = [];
  const withStatus = (t: Trip, reportId?: string): Trip => {
    const r = byReport.get(reportId ?? t.concur?.reportId ?? '');
    return r ? { ...t, concur: { ...t.concur, reportId: r.id, status: r.status, total: r.total, currency: r.currency, syncedAt: now } } : t;
  };
  for (const it of itins) {
    const local = trips.find((t) => t.concur?.itineraryId === it.id);
    // Buchungsdaten kommen aus Concur; Kunde, Checkliste, Belege und Notizen bleiben lokal
    const base: Trip = local ?? {
      id: `concur-${it.id}`, title: it.name, customer: '', destination: it.destination, country: it.country,
      departure: it.start, return: it.end, transport: it.transport, km: 0, breakfasts: 0, lunches: 0, dinners: 0,
      checklist: DEFAULT_CHECKLIST.map((text) => ({ id: uid(), text, done: false })), expenses: [],
    };
    const t = withStatus({
      ...base, departure: it.start, return: it.end, destination: it.destination || base.destination, country: it.country || base.country,
      transport: local ? base.transport : it.transport, hotel: it.hotel ?? base.hotel, bookingRefs: it.bookingRefs ?? base.bookingRefs,
      concur: { ...base.concur, itineraryId: it.id, syncedAt: now },
    }, it.reportId);
    put.set(t.id, t);
    events.push({ id: 'trip-' + t.id, tripId: t.id, type: 'reise', title: t.title || `Reise ${t.destination}`, startDate: it.start.slice(0, 10), endDate: it.end.slice(0, 10), location: t.destination, customer: t.customer || undefined, notes: [t.hotel && `Hotel: ${t.hotel}`, t.bookingRefs && `Buchungen: ${t.bookingRefs}`, 'Gebucht über SAP Concur'].filter(Boolean).join('\n') });
  }
  for (const t of trips) {
    if (put.has(t.id) || !t.concur?.reportId) continue;
    const u = withStatus(t);
    if (u !== t) put.set(t.id, u);
  }
  return { put: [...put.values()], events };
}

/* ---------- Live: Gateway der IT ---------- */

export function gatewayClient(base: string, fetchFn: typeof fetch = (...a) => fetch(...a)): ConcurClient {
  const root = base.replace(/\/+$/, '');
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(`${root}${path}`, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', accept: 'application/json', ...(init?.headers ?? {}) } });
    if (res.status === 401) throw new ConcurLoginError(`${root}/login`);
    if (res.status === 403) throw new Error('Concur: keine Berechtigung – bitte bei der IT anfragen');
    if (!res.ok) throw new Error(`Concur-Schnittstelle: Fehler ${res.status}`);
    return res.json() as Promise<T>;
  }
  const send = (method: 'POST' | 'PUT', path: string, body: unknown) => call<{ id: string }>(path, { method, body: JSON.stringify(body) }).then((r) => r.id);
  return {
    mode: 'live',
    reports: () => call('/me/reports'),
    itineraries: (from, to) => call(`/me/itineraries?from=${from}&to=${to}`),
    createReport: (r) => send('POST', '/me/reports', r),
    saveExpense: ({ id, reportId, ...e }) => send(id ? 'PUT' : 'POST', `/me/reports/${encodeURIComponent(reportId)}/expenses${id ? `/${encodeURIComponent(id)}` : ''}`, e),
    saveMileage: ({ id, reportId, ...m }) => send(id ? 'PUT' : 'POST', `/me/reports/${encodeURIComponent(reportId)}/mileage${id ? `/${encodeURIComponent(id)}` : ''}`, m),
  };
}

/* ---------- Demo ---------- */

export interface ConcurDemoStore { reports: Record<string, ConcurReport & { items: Record<string, number> }>; n: number }
const KEY = 'techdesk-concur-demo';
const load = (): ConcurDemoStore => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? ''); if (v?.reports) return v; } catch { /* leer */ } return { reports: {}, n: 0 }; };
const save = (s: ConcurDemoStore) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* egal */ } };
const add = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

/** Testdaten: eine bezahlte Reise (vor 3 Wochen) und eine gebuchte Reise (nächste Woche) */
export function demoConcur(today: () => string, store = { load, save }): ConcurClient {
  const fixed = () => {
    const t = today();
    const past: ConcurItinerary = { id: 'IT-DEMO-1', name: 'Service Nordsee Fisch KG', start: `${add(t, -24)}T06:10`, end: `${add(t, -21)}T19:30`, destination: 'Hafenweg 8, 27572 Bremerhaven', country: 'DE', transport: 'bahn', hotel: 'Hotel Am Hafen, Bremerhaven', bookingRefs: 'DB 7K2XQ9 · Hotel 448812', reportId: 'RPT-DEMO-PAID' };
    const next: ConcurItinerary = { id: 'IT-DEMO-2', name: 'Inbetriebnahme Lyon', start: `${add(t, 4)}T07:05`, end: `${add(t, 8)}T21:40`, destination: 'Lyon', country: 'FR', transport: 'flug', hotel: 'Novotel Lyon Confluence', bookingRefs: 'LH 1076 / LH 1077 · Sixt 9921-4410' };
    const paid: ConcurReport = { id: 'RPT-DEMO-PAID', name: 'Service Nordsee Fisch KG', status: 'Bezahlt', total: 642.8, currency: 'EUR' };
    return { itins: [past, next], paid };
  };
  return {
    mode: 'demo',
    async reports() {
      await pause();
      const st = store.load();
      return [fixed().paid, ...Object.values(st.reports).map(({ items, ...r }) => ({ ...r, total: Math.round(Object.values(items).reduce((a, b) => a + b, 0) * 100) / 100 }))];
    },
    async itineraries(from, to) { await pause(); return fixed().itins.filter((i) => i.end.slice(0, 10) >= from && i.start.slice(0, 10) <= to); },
    async createReport(r) {
      await pause(150);
      const st = store.load();
      const id = `RPT-DEMO-${++st.n}`;
      st.reports[id] = { id, name: r.name, status: 'Entwurf', total: 0, currency: 'EUR', items: {} };
      store.save(st);
      return id;
    },
    async saveExpense(e) {
      await pause(150);
      const st = store.load();
      const rep = st.reports[e.reportId];
      if (!rep) throw new Error('Abrechnung nicht gefunden');
      const id = e.id ?? `EXP-${++st.n}`;
      rep.items[id] = e.amount;
      store.save(st);
      return id;
    },
    async saveMileage(m) {
      await pause(150);
      const st = store.load();
      const rep = st.reports[m.reportId];
      if (!rep) throw new Error('Abrechnung nicht gefunden');
      const id = m.id ?? `MIL-${++st.n}`;
      rep.items[id] = Math.round(m.km * 0.3 * 100) / 100;
      store.save(st);
      return id;
    },
  };
}
const pause = (ms = 350) => new Promise((r) => setTimeout(r, ms));
