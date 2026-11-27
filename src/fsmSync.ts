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
  const cached = (await getMeta<FsmActivity[]>('fsm-activities')) ?? [];

  // 1. Senden
  const failed: string[] = [];
  let pushed = 0;
  const ops = planPush(await db.events.toArray(), await db.times.toArray(), state);
  for (const op of ops) {
    try {
      const remoteId = op.kind === 'activity' ? await c.saveActivity(op.write) : await c.saveTimeEffort(op.write);
      const r = afterPush(op, remoteId, state, new Date().toISOString());
      state = r.state;
      await db.transaction('rw', [db.events, db.times, db.meta], async () => {
        const tbl = op.kind === 'activity' ? db.events : db.times;
        const cur = await tbl.get(op.localId);
        if (cur && r.newId !== op.localId) {
          await tbl.delete(op.localId);
          const moved = op.kind === 'activity' ? { ...cur, id: r.newId, fsm: { ...(cur as { fsm?: object }).fsm, push: undefined, code: (cur as { fsm?: { code?: string } }).fsm?.code } } : { ...cur, id: r.newId };
          await tbl.put(moved as never);
          if (op.kind === 'activity') {
            const e = moved as Parameters<typeof db.events.put>[0];
            cached.push({ id: remoteId, code: e.fsm?.code ?? 'neu', subject: e.title, status: 'OPEN', start: `${e.startDate}T${e.startTime ?? '08:00'}`, end: `${e.endDate}T${e.endTime ?? '17:00'}`, serviceCall: { code: '', subject: '' }, customer: e.customer ?? '', address: e.location ?? '', equipment: { serial: e.machine ?? '', name: '' }, remarks: e.notes });
          }
        }
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
    // Auswahlliste: gelesene Einsätze plus selbst angelegte, die FSM noch nicht zurückmeldet
    const ids = new Set(acts.map((a) => a.id));
    const own = cached.filter((a) => !ids.has(a.id) && p.state[`fsm-${a.id}`]?.seen === false);
    await db.meta.put({ key: 'fsm-sync', value: p.state });
    await db.meta.put({ key: 'fsm-activities', value: [...acts, ...own] });
    await db.meta.put({ key: 'fsm-last-sync', value: new Date().toISOString() });
  });
  return { pushed, failed, activities: acts.length, efforts: efforts.length, at: new Date().toISOString() };
}

export const cachedActivities = async () => (await getMeta<FsmActivity[]>('fsm-activities')) ?? [];
export const lastFsmSync = () => getMeta<string>('fsm-last-sync');
export const clearFsmCache = async () => { await setMeta('fsm-activities', []); await setMeta('fsm-sync', {}); };
