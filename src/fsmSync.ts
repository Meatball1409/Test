import { db, getMeta, setMeta } from './db';
import { addDays, todayISO } from './lib/dates';
import { activityToEvent, demoClient, effortToEntry, type FsmActivity, type FsmClient } from './lib/fsm';
import { bridgeClient, fsmBridge } from './lib/fsmBridge';
import type { Settings } from './lib/types';

export function fsmClient(s: Settings): FsmClient | null {
  if (s.fsmMode === 'demo') return demoClient(todayISO);
  if (s.fsmMode === 'live') { const b = fsmBridge(); return b ? bridgeClient(b) : null; }
  return null;
}

export interface FsmSyncResult { activities: number; efforts: number; at: string }

/** Einsätze (−14 … +28 Tage) in den Kalender und gebuchte Zeiten in die Zeiterfassung übernehmen */
export async function syncFsm(s: Settings, what: { calendar?: boolean; times?: boolean } = { calendar: true, times: true }): Promise<FsmSyncResult> {
  const c = fsmClient(s);
  if (!c) throw new Error(s.fsmMode === 'live' ? 'Live-Abgleich geht nur, wenn TechDesk in der SAP-FSM-App geöffnet ist' : 'FSM ist nicht verbunden');
  const from = addDays(todayISO(), -14), to = addDays(todayISO(), 28);
  const acts = await c.activities(from, to);
  const efforts = what.times ? await c.timeEfforts(from, to) : [];
  await db.transaction('rw', [db.events, db.times, db.meta], async () => {
    if (what.calendar) {
      const old = await db.events.filter((e) => e.id.startsWith('fsm-') && e.endDate >= from && e.startDate <= to).primaryKeys();
      await db.events.bulkDelete(old);
      await db.events.bulkPut(acts.map(activityToEvent));
    }
    if (what.times) {
      const old = await db.times.filter((t) => t.id.startsWith('fsm-') && t.date >= from && t.date <= to).primaryKeys();
      await db.times.bulkDelete(old);
      await db.times.bulkPut(efforts.map((t) => effortToEntry(t, acts)));
    }
    await db.meta.put({ key: 'fsm-activities', value: acts });
    await db.meta.put({ key: 'fsm-last-sync', value: new Date().toISOString() });
  });
  return { activities: acts.length, efforts: efforts.length, at: new Date().toISOString() };
}

export const cachedActivities = async () => (await getMeta<FsmActivity[]>('fsm-activities')) ?? [];
export const lastFsmSync = () => getMeta<string>('fsm-last-sync');
export const clearFsmCache = async () => { await setMeta('fsm-activities', []); };
