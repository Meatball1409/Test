/**
 * Anbindung an SAP Field Service Management (FSM).
 * - Typen orientieren sich an den FSM-Objekten Activity, ServiceCall, Equipment, TimeEffort.
 * - Abbildung auf TechDesk: Activity → Kalendertermin, TimeEffort → Zeitabschnitt, Bericht → Activity (Text + PDF).
 * - Demo-Daten für Präsentationen (frei erfunden, deutlich als Testdaten gekennzeichnet).
 */
import { addDays, weekday } from './dates';
import type { CalendarEvent, TimeEntry } from './types';

export interface FsmActivity {
  id: string;
  code: string; // Einsatznummer
  subject: string;
  status: 'OPEN' | 'CLOSED'; // Abschluss erfolgt in FSM
  start: string; // ISO lokal 'YYYY-MM-DDTHH:MM'
  end: string;
  serviceCall: { code: string; subject: string };
  customer: string;
  address: string;
  equipment: { serial: string; name: string };
  remarks?: string;
}
export type FsmTask = 'Reisezeit' | 'Kundenbesuch' | 'Arbeitszeit';
export interface FsmTimeEffort { id: string; activityId: string; task: FsmTask; start: string; end: string; breakMin?: number; remarks?: string }
export interface FsmReportPayload { activityId: string; text: string; html?: string; fileName?: string }
/** Schreibbare Felder eines Einsatzes (Termine plant die Disposition in FSM) */
export interface FsmActivityWrite { id?: string; subject: string; remarks?: string }
export type FsmEffortWrite = Omit<FsmTimeEffort, 'id'> & { id?: string };

export interface FsmClient {
  mode: 'demo' | 'live';
  activities(from: string, to: string): Promise<FsmActivity[]>;
  timeEfforts(from: string, to: string): Promise<FsmTimeEffort[]>;
  /** legt an (ohne id) oder ändert; liefert die FSM-ID */
  saveActivity(a: FsmActivityWrite): Promise<string>;
  saveTimeEffort(e: FsmEffortWrite): Promise<string>;
  sendReport(p: FsmReportPayload): Promise<{ ok: true; at: string }>;
}

/** FSM liefert UTC ('…Z' bzw. mit Offset) → lokale Zeit 'YYYY-MM-DDTHH:MM'. Ohne Zone: unverändert. */
export function toLocal(dt: string): string {
  if (!dt) return '';
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(dt)) return dt.slice(0, 16);
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** lokale Zeit 'YYYY-MM-DDTHH:MM' → ISO UTC für FSM */
export const toUtc = (local: string) => new Date(local).toISOString();

export function activityToEvent(a: FsmActivity): CalendarEvent {
  return {
    id: `fsm-${a.id}`, type: 'einsatz', title: a.subject,
    startDate: a.start.slice(0, 10), endDate: (a.end || a.start).slice(0, 10),
    startTime: a.start.slice(11, 16) || undefined, endTime: a.end.slice(11, 16) || undefined,
    customer: a.customer, location: a.address, machine: a.equipment.serial,
    notes: a.remarks ?? '',
    fsm: { code: a.code, serviceCall: a.serviceCall.code, equipment: a.equipment.name },
  };
}

export const kindToTask = (k: TimeEntry['kind']): FsmTask => (k === 'reise' ? 'Reisezeit' : k === 'kunde' ? 'Kundenbesuch' : 'Arbeitszeit');

export function effortToEntry(t: FsmTimeEffort, activities: FsmActivity[]): TimeEntry {
  const a = activities.find((x) => x.id === t.activityId);
  return {
    id: `fsm-${t.id}`, date: t.start.slice(0, 10), kind: t.task === 'Reisezeit' ? 'reise' : t.task === 'Kundenbesuch' ? 'kunde' : 'arbeit',
    start: t.start.slice(11, 16), end: t.end.slice(11, 16), breakMin: t.breakMin ?? 0, customer: a?.customer, note: t.remarks ?? '',
    fsm: { activityId: t.activityId, code: a?.code },
  };
}

/** Zeiteintrag → Zeitbuchung (nur mit Einsatz und Uhrzeiten) */
export function entryToEffort(e: TimeEntry): FsmEffortWrite | null {
  const activityId = e.fsm?.activityId;
  if (!activityId || !e.start || !e.end || !['arbeit', 'kunde', 'reise'].includes(e.kind)) return null;
  const endDate = e.end <= e.start ? addDays(e.date, 1) : e.date; // über Mitternacht
  return {
    id: e.id.startsWith('fsm-') ? e.id.slice(4) : undefined, activityId, task: kindToTask(e.kind),
    start: `${e.date}T${e.start}`, end: `${endDate}T${e.end}`, breakMin: e.breakMin ?? 0, remarks: e.note ?? '',
  };
}
export const eventToActivity = (e: CalendarEvent): FsmActivityWrite => ({
  id: e.id.startsWith('fsm-') ? e.id.slice(4) : undefined, subject: e.title, remarks: e.notes ?? '',
});

/* ---------- Demo ---------- */

const CUSTOMERS = [
  { name: 'Musterfood GmbH', address: 'Industriestraße 12, 87437 Kempten', machine: 'Thermoforming packaging machine R 245', subject: 'Preventive maintenance R 245' },
  { name: 'Alpen Käse AG', address: 'Seestraße 3, 88131 Lindau', machine: 'Traysealer T 800', subject: 'Commissioning T 800' },
  { name: 'Nordsee Fisch KG', address: 'Hafenweg 8, 27572 Bremerhaven', machine: 'Chamber belt machine B 625', subject: 'Repair: sealing bar B 625' },
  { name: 'Bäckerei Sonnenschein', address: 'Marktplatz 1, 86150 Augsburg', machine: 'Labeller L 310', subject: 'Format change L 310' },
  { name: 'Fleischwerk Süd GmbH', address: 'Gewerbering 44, 89073 Ulm', machine: 'Thermoforming packaging machine R 535', subject: 'Training operators R 535' },
];

/** Demo-Einsätze rund um `today`: letzte Woche (mit Zeiten) und die nächsten zwei Wochen */
export function demoData(today: string): { activities: FsmActivity[]; efforts: FsmTimeEffort[] } {
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const plan: [number, number, number][] = [ // [Tag relativ zum Montag, Dauer in Tagen, Kunde]
    [-7, 2, 0], [-5, 3, 2], [0, 2, 1], [2, 1, 3], [7, 3, 4], [10, 1, 0],
  ];
  const activities: FsmActivity[] = [];
  const efforts: FsmTimeEffort[] = [];
  plan.forEach(([off, len, ci], k) => {
    const c = CUSTOMERS[ci];
    const s = addDays(monday, off), e = addDays(s, len - 1);
    const id = `DEMO${String(k + 1).padStart(3, '0')}`;
    const a: FsmActivity = {
      id, code: `A-26${String(4810 + k)}`, subject: c.subject, status: e < today ? 'CLOSED' : 'OPEN',
      start: `${s}T08:00`, end: `${e}T17:00`, serviceCall: { code: `SC-26${String(7720 + k)}`, subject: c.subject },
      customer: c.name, address: c.address, equipment: { serial: String(150300 + k * 37), name: c.machine },
    };
    activities.push(a);
    if (e < today) {
      for (let i = 0; i < len; i++) {
        const d = addDays(s, i);
        if (weekday(d) === 0) continue;
        const first = i === 0, last = i === len - 1;
        let n = 0;
        const add = (task: FsmTimeEffort['task'], from: string, to: string) => efforts.push({ id: `${id}-${i}-${n++}`, activityId: id, task, start: `${d}T${from}`, end: `${d}T${to}` });
        if (first) add('Reisezeit', '06:30', '08:00');
        add('Kundenbesuch', '08:00', '12:00');
        add('Kundenbesuch', '12:45', last ? '15:30' : '17:30');
        if (last) add('Reisezeit', '15:30', '17:15');
      }
    }
  });
  return { activities, efforts };
}

/** Demo-Speicher: was in der Präsentation „an FSM gesendet“ wird, bleibt im Browser erhalten */
export interface DemoStore { activities: Record<string, FsmActivity>; efforts: Record<string, FsmTimeEffort>; n: number }
const STORE_KEY = 'techdesk-fsm-demo';
function loadStore(): DemoStore {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? ''); if (v && v.activities) return v; } catch { /* leer */ }
  return { activities: {}, efforts: {}, n: 0 };
}
function saveStore(st: DemoStore) { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* egal */ } }

export function demoClient(today: () => string, store: { load: () => DemoStore; save: (s: DemoStore) => void } = { load: loadStore, save: saveStore }): FsmClient {
  const all = () => {
    const st = store.load(), d = demoData(today());
    const acts = new Map(d.activities.map((a) => [a.id, a]));
    for (const a of Object.values(st.activities)) acts.set(a.id, a);
    const efforts = new Map(d.efforts.map((t) => [t.id, t]));
    for (const t of Object.values(st.efforts)) efforts.set(t.id, t);
    return { st, acts: [...acts.values()], efforts: [...efforts.values()] };
  };
  return {
    mode: 'demo',
    // Neu angelegte Einsätze tauchen (wie in FSM) erst nach der Disposition in der eigenen Liste auf
    async activities(from, to) { await delay(); return all().acts.filter((a) => !a.id.startsWith('DEMO-N') && a.end.slice(0, 10) >= from && a.start.slice(0, 10) <= to); },
    async timeEfforts(from, to) { await delay(); return all().efforts.filter((t) => t.start.slice(0, 10) >= from && t.start.slice(0, 10) <= to); },
    async saveActivity(w) {
      await delay(150);
      const { st, acts } = all();
      const id = w.id ?? `DEMO-N${++st.n}`;
      const old = acts.find((a) => a.id === id);
      const now = `${today()}T08:00`;
      st.activities[id] = old ? { ...old, subject: w.subject, remarks: w.remarks } : {
        id, code: `A-NEU-${st.n}`, subject: w.subject, remarks: w.remarks, status: 'OPEN', start: now, end: `${today()}T17:00`,
        serviceCall: { code: '', subject: '' }, customer: '', address: '', equipment: { serial: '', name: '' },
      };
      store.save(st);
      return id;
    },
    async saveTimeEffort(w) {
      await delay(150);
      const { st } = all();
      const id = w.id ?? `DEMO-T${++st.n}`;
      st.efforts[id] = { ...w, id };
      store.save(st);
      return id;
    },
    async sendReport() { await delay(700); return { ok: true, at: new Date().toISOString() }; },
  };
}
const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
