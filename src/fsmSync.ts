import { db, getMeta, setMeta } from './db';
import { addDays, todayISO } from './lib/dates';
import { demoClient, type FsmActivity, type FsmClient } from './lib/fsm';
import { bridgeClient, fsmBridge } from './lib/fsmBridge';
import { afterPush, planPull, planPush, type SyncState } from './lib/fsmSyncCore';
import type { Settings } from './lib/types';

export function fsmClient(s: Settings): FsmClient | null {
  if (s.fsmMode === 'demo') return demoClient(todayISO);
  if (s.fsmMode === 'live') { const b = fsmBridge(); return b ? bridgeClient(b) : null; }
  return null;
}

export interface FsmSyncResult { pushed: number; failed: string[]; activities: number; efforts: number; at: string }

let running: Promise<FsmSyncResult> | null = null;

/** Abgleich in beide Richtungen: lokale Änderungen senden, dann Einsätze (−30 … +60 Tage) und Zeiten holen */
export function syncFsm(s: Settings): Promise<FsmSyncResult> {
  running ??= run(s).finally(() => { running = null; });
  return running;
}

async function run(s: Settings): Promise<FsmSyncResult> {
  const c = fsmClient(s);
  if (!c) throw new Error(s.fsmMode === 'live' ? 'Live-Abgleich geht nur, wenn TechDesk in der SAP-FSM-App geöffnet ist' : 'FSM ist nicht verbunden');
  const from = addDays(todayISO(), -30), to = addDays(todayISO(), 60);
  let state = (await getMeta<SyncState>('fsm-sync')) ?? {};

  // 1. Senden
  const failed: string[] = [];
  let pushed = 0;
  const ops = planPush(await db.events.toArray(), await db.times.toArray(), state);
  for (const op of ops) {
    try {
      const remoteId = op.kind === 'activity' ? await c.saveActivity(op.write) : await c.saveTimeEffort(op.write);
      const r = afterPush(op, remoteId, state, new Date().toISOString());
      state = r.state;
      await db.transaction('rw', [db.times, db.meta], async () => {
        // neue Zeitbuchung: lokalen Eintrag auf die FSM-ID umschlüsseln
        const cur = op.kind === 'effort' && r.newId !== op.localId ? await db.times.get(op.localId) : undefined;
        if (cur) { await db.times.delete(op.localId); await db.times.put({ ...cur, id: r.newId }); }
        await db.meta.put({ key: 'fsm-sync', value: state });
      });
      pushed++;
    } catch (e) {
      failed.push(`${op.kind === 'activity' ? 'Einsatz' : 'Zeit'}: ${(e as Error).message}`);
    }
  }

  // 2. Holen
  const acts = await c.activities(from, to);
  const efforts = await c.timeEfforts(from, to);
  await db.transaction('rw', [db.events, db.times, db.meta], async () => {
    const p = planPull({ events: await db.events.toArray(), times: await db.times.toArray() }, { activities: acts, efforts }, { from, to }, state, new Date().toISOString());
    await db.events.bulkDelete(p.delEvents); await db.events.bulkPut(p.putEvents);
    await db.times.bulkDelete(p.delTimes); await db.times.bulkPut(p.putTimes);
    await db.meta.put({ key: 'fsm-sync', value: p.state });
    await db.meta.put({ key: 'fsm-activities', value: acts });
    await db.meta.put({ key: 'fsm-last-sync', value: new Date().toISOString() });
  });
  return { pushed, failed, activities: acts.length, efforts: efforts.length, at: new Date().toISOString() };
}

export const cachedActivities = async () => (await getMeta<FsmActivity[]>('fsm-activities')) ?? [];
export const lastFsmSync = () => getMeta<string>('fsm-last-sync');
export const clearFsmCache = async () => { await setMeta('fsm-activities', []); await setMeta('fsm-sync', {}); };
