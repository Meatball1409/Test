/**
 * Abgleich TechDesk ⇄ SAP FSM in beide Richtungen – reine Logik (ohne Datenbank/Netz).
 *
 * Regeln
 * - FSM bleibt führend für Termine (Disposition), Kunde, Adresse, Maschine und Status (Abschluss in FSM).
 * - TechDesk → FSM: Titel und Notizen von Einsätzen; neue Einsätze („in FSM anlegen“);
 *   Zeitbuchungen (Anlegen und Ändern) für Einträge, die einem Einsatz zugeordnet sind.
 * - Lokale Änderungen gehen vor: Was noch nicht übertragen ist bzw. in FSM noch nicht angekommen ist,
 *   wird beim Herunterladen nicht überschrieben.
 * - Löschen: Einträge, die in FSM verschwunden sind, werden lokal entfernt – aber nur, wenn sie
 *   schon einmal aus FSM kamen und lokal nicht geändert wurden.
 */
import type { CalendarEvent, TimeEntry } from './types';
import { activityToEvent, effortToEntry, entryToEffort, eventToActivity, type FsmActivity, type FsmActivityWrite, type FsmEffortWrite, type FsmTimeEffort } from './fsm';

/** Stand je lokalem Datensatz nach dem letzten Abgleich */
export interface SyncMark {
  h: string; // Hash des abgeglichenen Inhalts
  seen?: boolean; // schon einmal aus FSM gelesen
  pending?: string; // gesendet am …, in FSM noch nicht bestätigt
}
export type SyncState = Record<string, SyncMark>;

const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
/** Nur die Felder, die TechDesk nach FSM schreibt */
export const hashEvent = (e: CalendarEvent) => stable({ t: e.title ?? '', n: e.notes ?? '' });
export const hashTime = (e: TimeEntry) => stable({ d: e.date, k: e.kind, s: e.start ?? '', e: e.end ?? '', b: e.breakMin ?? 0, n: e.note ?? '', a: e.fsm?.activityId ?? '' });

const PENDING_MAX_DAYS = 7;
const isFsm = (id: string) => id.startsWith('fsm-');
const markOf = (st: SyncState, id: string, h: string): SyncMark => st[id] ?? { h, seen: true }; // ältere Daten ohne Stand gelten als abgeglichen

export type PushOp =
  | { kind: 'activity'; localId: string; write: FsmActivityWrite; hash: string }
  | { kind: 'effort'; localId: string; write: FsmEffortWrite; hash: string };

/** Was muss nach FSM? */
export function planPush(events: CalendarEvent[], times: TimeEntry[], st: SyncState): PushOp[] {
  const ops: PushOp[] = [];
  for (const e of events) {
    const h = hashEvent(e);
    if (isFsm(e.id)) { if (markOf(st, e.id, h).h !== h) ops.push({ kind: 'activity', localId: e.id, write: eventToActivity(e), hash: h }); }
    else if (e.type === 'einsatz' && e.fsm?.push) ops.push({ kind: 'activity', localId: e.id, write: eventToActivity(e), hash: h });
  }
  for (const t of times) {
    const w = entryToEffort(t);
    if (!w) continue;
    const h = hashTime(t);
    if (!isFsm(t.id) || markOf(st, t.id, h).h !== h) ops.push({ kind: 'effort', localId: t.id, write: w, hash: h });
  }
  // Neue Einsätze zuerst, damit Zeitbuchungen auf sie zeigen können
  return ops.sort((a, b) => Number(a.kind === 'effort') - Number(b.kind === 'effort'));
}

/** Nach erfolgreichem Senden: lokalen Datensatz ggf. auf die FSM-ID umschlüsseln und als „unterwegs“ merken */
export function afterPush(op: PushOp, remoteId: string, st: SyncState, now: string): { newId: string; state: SyncState } {
  const newId = `fsm-${remoteId}`;
  const state = { ...st };
  const prev = st[op.localId];
  if (op.localId !== newId) delete state[op.localId];
  state[newId] = { h: op.hash, seen: prev?.seen ?? false, pending: now };
  return { newId, state };
}

export interface PullResult {
  putEvents: CalendarEvent[]; delEvents: string[];
  putTimes: TimeEntry[]; delTimes: string[];
  state: SyncState;
}

const ageDays = (from: string, now: string) => (Date.parse(now) - Date.parse(from)) / 86_400_000;

/** Stand aus FSM übernehmen, ohne lokale (noch nicht bestätigte) Änderungen zu überschreiben */
export function planPull(
  local: { events: CalendarEvent[]; times: TimeEntry[] },
  remote: { activities: FsmActivity[]; efforts: FsmTimeEffort[] },
  range: { from: string; to: string },
  st: SyncState, now: string,
): PullResult {
  const state: SyncState = { ...st };
  const out: PullResult = { putEvents: [], delEvents: [], putTimes: [], delTimes: [], state };

  function merge<T extends { id: string }>(remoteRec: T, localRec: T | undefined, hash: (x: T) => string, combine: (keepLocal: T, rem: T) => T, put: T[]) {
    const rh = hash(remoteRec);
    if (!localRec) { put.push(remoteRec); state[remoteRec.id] = { h: rh, seen: true }; return; }
    const lh = hash(localRec);
    const m = markOf(st, localRec.id, lh);
    const dirty = lh !== m.h; // lokal geändert, noch nicht gesendet
    const waiting = m.pending && rh !== m.h && ageDays(m.pending, now) < PENDING_MAX_DAYS; // gesendet, FSM noch alter Stand
    if (dirty || waiting) { put.push(combine(localRec, remoteRec)); state[localRec.id] = { ...m, seen: true }; return; }
    put.push(combine(remoteRec, remoteRec));
    state[localRec.id] = { h: rh, seen: true };
  }

  const evById = new Map(local.events.map((e) => [e.id, e]));
  const remoteEv = new Set<string>();
  for (const a of remote.activities) {
    const r = activityToEvent(a);
    remoteEv.add(r.id);
    const l = evById.get(r.id);
    // Termine/Kunde/Ort kommen immer aus FSM; Titel/Notizen ggf. lokal; lokale Extras (Reise) bleiben
    merge(r, l, hashEvent, (keep, rem) => ({ ...l, ...rem, title: keep.title, notes: keep.notes }), out.putEvents);
  }
  const tmById = new Map(local.times.map((t) => [t.id, t]));
  const remoteTm = new Set<string>();
  for (const t of remote.efforts) {
    const r = effortToEntry(t, remote.activities);
    remoteTm.add(r.id);
    const l = tmById.get(r.id);
    merge(r, l, hashTime, (keep, rem) => (keep === rem ? { ...rem, customer: rem.customer ?? l?.customer, fsm: { activityId: rem.fsm!.activityId, code: rem.fsm?.code ?? l?.fsm?.code } } : keep), out.putTimes);
  }

  const gone = (id: string, h: string) => {
    const m = markOf(st, id, h);
    return m.seen !== false && h === m.h && !(m.pending && ageDays(m.pending, now) < PENDING_MAX_DAYS);
  };
  for (const e of local.events) {
    if (!isFsm(e.id) || remoteEv.has(e.id) || e.endDate < range.from || e.startDate > range.to) continue;
    if (gone(e.id, hashEvent(e))) { out.delEvents.push(e.id); delete state[e.id]; }
  }
  for (const t of local.times) {
    if (!isFsm(t.id) || remoteTm.has(t.id) || t.date < range.from || t.date > range.to) continue;
    if (gone(t.id, hashTime(t))) { out.delTimes.push(t.id); delete state[t.id]; }
  }
  return out;
}
