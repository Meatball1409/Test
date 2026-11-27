import { SUPABASE_URL } from './config';
import { db, getMeta, setMeta } from './db';
import { addDays, todayISO } from './lib/dates';
import { activityToEvent, demoClient, effortToEntry, type FsmActivity, type FsmClient, type FsmReportPayload } from './lib/fsm';
import type { Settings } from './lib/types';
import { supabase } from './sync';

/**
 * Live-Anbindung: Die App spricht NICHT direkt mit FSM. Ein geschützter Server-Baustein
 * (supabase/functions/fsm) hält die FSM-Zugangsdaten, prüft die TechDesk-Anmeldung und
 * liefert nur die Einsätze/Zeiten des angemeldeten Technikers.
 */
function liveClient(): FsmClient | null {
  if (!supabase || !SUPABASE_URL) return null;
  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const { data } = await supabase!.auth.getSession();
    if (!data.session) throw new Error('Nicht angemeldet');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fsm${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session.access_token}`, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`FSM-Schnittstelle: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  return {
    mode: 'live',
    activities: (from, to) => call(`/activities?from=${from}&to=${to}`),
    timeEfforts: (from, to) => call(`/time-efforts?from=${from}&to=${to}`),
    sendReport: (p: FsmReportPayload) => call('/report', { method: 'POST', body: JSON.stringify(p) }),
  };
}

export function fsmClient(s: Settings): FsmClient | null {
  if (s.fsmMode === 'demo') return demoClient(todayISO);
  if (s.fsmMode === 'live') return liveClient();
  return null;
}

export interface FsmSyncResult { activities: number; efforts: number; at: string }

/** Einsätze (−14 … +28 Tage) in den Kalender und gebuchte Zeiten in die Zeiterfassung übernehmen */
export async function syncFsm(s: Settings, what: { calendar?: boolean; times?: boolean } = { calendar: true, times: true }): Promise<FsmSyncResult> {
  const c = fsmClient(s);
  if (!c) throw new Error('FSM ist nicht verbunden');
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
