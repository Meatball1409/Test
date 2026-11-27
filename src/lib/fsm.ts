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
  status: 'OPEN' | 'CLOSED';
  start: string; // ISO lokal 'YYYY-MM-DDTHH:MM'
  end: string;
  serviceCall: { code: string; subject: string };
  customer: string;
  address: string;
  equipment: { serial: string; name: string };
}
export interface FsmTimeEffort { id: string; activityId: string; task: 'Reisezeit' | 'Kundenbesuch' | 'Arbeitszeit'; start: string; end: string }
export interface FsmReportPayload { activityId: string; text: string; pdfFileName?: string }

export interface FsmClient {
  mode: 'demo' | 'live';
  activities(from: string, to: string): Promise<FsmActivity[]>;
  timeEfforts(from: string, to: string): Promise<FsmTimeEffort[]>;
  sendReport(p: FsmReportPayload): Promise<{ ok: true; at: string }>;
}

export function activityToEvent(a: FsmActivity): CalendarEvent {
  return {
    id: `fsm-${a.id}`, type: 'einsatz', title: a.subject,
    startDate: a.start.slice(0, 10), endDate: a.end.slice(0, 10),
    startTime: a.start.slice(11, 16), endTime: a.end.slice(11, 16),
    customer: a.customer, location: a.address, machine: a.equipment.serial,
    notes: `FSM-Einsatz ${a.code} · Serviceauftrag ${a.serviceCall.code}\n${a.equipment.name}`,
  };
}

export function effortToEntry(t: FsmTimeEffort, activities: FsmActivity[]): TimeEntry {
  const a = activities.find((x) => x.id === t.activityId);
  return {
    id: `fsm-${t.id}`, date: t.start.slice(0, 10), kind: t.task === 'Reisezeit' ? 'reise' : t.task === 'Kundenbesuch' ? 'kunde' : 'arbeit',
    start: t.start.slice(11, 16), end: t.end.slice(11, 16), breakMin: 0, customer: a?.customer, note: a ? `FSM ${a.code}` : 'FSM',
  };
}

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

export function demoClient(today: () => string): FsmClient {
  return {
    mode: 'demo',
    async activities(from, to) { await delay(); return demoData(today()).activities.filter((a) => a.end.slice(0, 10) >= from && a.start.slice(0, 10) <= to); },
    async timeEfforts(from, to) { await delay(); return demoData(today()).efforts.filter((t) => t.start.slice(0, 10) >= from && t.start.slice(0, 10) <= to); },
    async sendReport() { await delay(700); return { ok: true, at: new Date().toISOString() }; },
  };
}
const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
