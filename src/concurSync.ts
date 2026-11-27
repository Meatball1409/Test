import { db, setMeta } from './db';
import { addDays, todayISO } from './lib/dates';
import { applyOp, demoConcur, gatewayClient, planPull, planTripPush, type ConcurClient } from './lib/concur';
import type { Settings, Trip } from './lib/types';

/** Adresse der Concur-Schnittstelle auf der Plattform der IT (beim Build gesetzt) */
export const CONCUR_GATEWAY: string = import.meta.env.VITE_CONCUR_GATEWAY_URL || '';

export function concurClient(s: Settings): ConcurClient | null {
  if (s.concurMode === 'demo') return demoConcur(todayISO);
  if (s.concurMode === 'live' && CONCUR_GATEWAY) return gatewayClient(CONCUR_GATEWAY);
  return null;
}
const need = (s: Settings) => {
  const c = concurClient(s);
  if (!c) throw new Error(s.concurMode === 'live' ? 'Concur-Schnittstelle ist noch nicht eingerichtet (IT)' : 'Concur ist nicht verbunden');
  return c;
};

/** Eine Reise an Concur senden: Abrechnung anlegen bzw. ergänzen, Belege mit Foto, Kilometer */
export async function sendTrip(s: Settings, tripId: string, c = need(s)): Promise<{ sent: number; failed: string[] }> {
  let t = await db.trips.get(tripId);
  if (!t) throw new Error('Reise nicht gefunden');
  const failed: string[] = [];
  let sent = 0;
  for (const op of planTripPush(t)) {
    try {
      const reportId = t.concur?.reportId;
      const id = op.kind === 'report' ? await c.createReport(op.write)
        : op.kind === 'expense' ? await c.saveExpense({ ...op.write, reportId: reportId! })
        : await c.saveMileage({ ...op.write, reportId: reportId! });
      t = applyOp(t, op, id, new Date().toISOString());
      await db.trips.put(t);
      if (op.kind !== 'report') sent++;
    } catch (e) {
      if (op.kind === 'report') throw e;
      failed.push((e as Error).message);
    }
  }
  return { sent, failed };
}

export interface ConcurSyncResult { sent: number; failed: string[]; trips: number; reports: number }

/** Abgleich in beide Richtungen: offene Änderungen verknüpfter Reisen senden, dann Status und Buchungen holen */
export async function syncConcur(s: Settings): Promise<ConcurSyncResult> {
  const c = need(s);
  let sent = 0;
  const failed: string[] = [];
  for (const t of await db.trips.toArray()) {
    if (!t.concur?.reportId || !planTripPush(t).length) continue;
    const r = await sendTrip(s, t.id, c);
    sent += r.sent; failed.push(...r.failed);
  }
  const reports = await c.reports();
  const itins = await c.itineraries(addDays(todayISO(), -60), addDays(todayISO(), 180));
  let trips = 0;
  await db.transaction('rw', [db.trips, db.events, db.meta], async () => {
    const p = planPull(await db.trips.toArray(), reports, itins, new Date().toISOString());
    await db.trips.bulkPut(p.put);
    await db.events.bulkPut(p.events);
    trips = itins.length;
    await db.meta.put({ key: 'concur-last-sync', value: new Date().toISOString() });
  });
  return { sent, failed, trips, reports: reports.length };
}

export async function removeConcurData() {
  const trips = await db.trips.toArray();
  const linked = trips.filter((t: Trip) => t.id.startsWith('concur-'));
  await db.trips.bulkDelete(linked.map((t) => t.id));
  await db.events.bulkDelete(linked.map((t) => 'trip-' + t.id));
  await db.trips.bulkPut(trips.filter((t) => !t.id.startsWith('concur-') && t.concur).map((t) => ({ ...t, concur: undefined, expenses: t.expenses.map((e) => ({ ...e, concur: undefined })) })));
  await setMeta('concur-last-sync', undefined);
  return linked.length;
}
