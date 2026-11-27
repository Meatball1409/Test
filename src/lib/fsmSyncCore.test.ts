import { describe, expect, it } from 'vitest';
import { demoClient, type DemoStore, type FsmActivity, type FsmTimeEffort } from './fsm';
import { afterPush, hashEvent, hashTime, planPull, planPush, type SyncState } from './fsmSyncCore';
import type { CalendarEvent, TimeEntry } from './types';

const act = (id: string, p: Partial<FsmActivity> = {}): FsmActivity => ({ id, code: 'A-' + id, subject: 'Wartung', status: 'OPEN', start: '2026-11-30T08:00', end: '2026-11-30T17:00', serviceCall: { code: 'SC1', subject: '' }, customer: 'Musterfood', address: 'Kempten', equipment: { serial: '150300', name: 'R 245' }, remarks: '', ...p });
const eff = (id: string, p: Partial<FsmTimeEffort> = {}): FsmTimeEffort => ({ id, activityId: 'A1', task: 'Kundenbesuch', start: '2026-11-30T08:00', end: '2026-11-30T12:00', breakMin: 0, remarks: '', ...p });
const range = { from: '2026-11-01', to: '2026-12-31' };
const NOW = '2026-11-30T18:00:00Z';
const empty = { events: [] as CalendarEvent[], times: [] as TimeEntry[] };

/** Ein kompletter Durchlauf wie auf dem Gerät: senden, dann holen */
async function cycle(local: { events: CalendarEvent[]; times: TimeEntry[] }, st: SyncState, c: ReturnType<typeof demoClient>) {
  let state = st;
  let events = [...local.events], times = [...local.times];
  for (const op of planPush(events, times, state)) {
    const id = op.kind === 'activity' ? await c.saveActivity(op.write) : await c.saveTimeEffort(op.write);
    const r = afterPush(op, id, state, NOW);
    state = r.state;
    if (op.kind === 'effort') times = times.map((t) => (t.id === op.localId ? { ...t, id: r.newId } : t));
  }
  const p = planPull({ events, times }, { activities: await c.activities(range.from, range.to), efforts: await c.timeEfforts(range.from, range.to) }, range, state, NOW);
  events = events.filter((e) => !p.delEvents.includes(e.id)); times = times.filter((t) => !p.delTimes.includes(t.id));
  for (const e of p.putEvents) events = [...events.filter((x) => x.id !== e.id), e];
  for (const t of p.putTimes) times = [...times.filter((x) => x.id !== t.id), t];
  return { events, times, state: p.state };
}
function memStore() { let st: DemoStore = { activities: {}, efforts: {}, n: 0 }; return { load: () => structuredClone(st), save: (s: DemoStore) => { st = structuredClone(s); }, get: () => st }; }

describe('FSM-Abgleich in beide Richtungen', () => {
  it('erstes Holen: Einsätze und Zeiten landen lokal und gelten als abgeglichen', () => {
    const p = planPull(empty, { activities: [act('A1')], efforts: [eff('T1')] }, range, {}, NOW);
    expect(p.putEvents.map((e) => e.id)).toEqual(['fsm-A1']);
    expect(p.putTimes[0]).toMatchObject({ id: 'fsm-T1', kind: 'kunde', customer: 'Musterfood', fsm: { activityId: 'A1', code: 'A-A1' } });
    expect(planPush(p.putEvents, p.putTimes, p.state)).toEqual([]);
  });

  it('lokale Änderung wird gesendet – nur schreibbare Felder; Termin kommt weiter aus FSM', () => {
    const p = planPull(empty, { activities: [act('A1')], efforts: [eff('T1')] }, range, {}, NOW);
    const ev = { ...p.putEvents[0], title: 'Wartung + Formatwechsel', notes: 'Folie fehlt' };
    const tm = { ...p.putTimes[0], end: '12:30' };
    const ops = planPush([ev], [tm], p.state);
    expect(ops.map((o) => o.kind)).toEqual(['activity', 'effort']);
    expect(ops[0].write).toEqual({ id: 'A1', subject: 'Wartung + Formatwechsel', remarks: 'Folie fehlt' });
    expect(ops[1].write).toMatchObject({ id: 'T1', activityId: 'A1', start: '2026-11-30T08:00', end: '2026-11-30T12:30', task: 'Kundenbesuch' });
  });

  it('gesendet, aber FSM liefert noch den alten Stand: lokale Werte bleiben, neuer Termin wird übernommen', () => {
    const first = planPull(empty, { activities: [act('A1')], efforts: [eff('T1')] }, range, {}, NOW);
    const ev = { ...first.putEvents[0], title: 'Neu' };
    const tm = { ...first.putTimes[0], end: '12:30' };
    let st = first.state;
    for (const op of planPush([ev], [tm], st)) st = afterPush(op, op.localId.slice(4), st, NOW).state;
    const p = planPull({ events: [ev], times: [tm] }, { activities: [act('A1', { start: '2026-12-01T09:00', end: '2026-12-01T15:00' })], efforts: [eff('T1')] }, range, st, NOW);
    expect(p.putEvents[0]).toMatchObject({ title: 'Neu', startDate: '2026-12-01', startTime: '09:00' });
    expect(p.putTimes[0].end).toBe('12:30');
    // Sobald FSM den Stand bestätigt, ist nichts mehr offen
    const ok = planPull({ events: p.putEvents, times: p.putTimes }, { activities: [act('A1', { subject: 'Neu' })], efforts: [eff('T1', { end: '2026-11-30T12:30' })] }, range, p.state, NOW);
    expect(ok.state['fsm-T1'].pending).toBeUndefined();
    expect(planPush(ok.putEvents, ok.putTimes, ok.state)).toEqual([]);
  });

  it('Änderung in FSM überschreibt unveränderte lokale Daten; in FSM entfernte Einträge verschwinden', () => {
    const first = planPull(empty, { activities: [act('A1'), act('A2')], efforts: [eff('T1'), eff('T2')] }, range, {}, NOW);
    const p = planPull({ events: first.putEvents, times: first.putTimes }, { activities: [act('A1', { remarks: 'vom Innendienst' })], efforts: [eff('T1', { start: '2026-11-30T07:30' })] }, range, first.state, NOW);
    expect(p.putEvents[0].notes).toBe('vom Innendienst');
    expect(p.putTimes[0].start).toBe('07:30');
    expect(p.delEvents).toEqual(['fsm-A2']);
    expect(p.delTimes).toEqual(['fsm-T2']);
  });

  it('lokal geänderte, noch nicht gesendete Einträge werden nie gelöscht oder überschrieben', () => {
    const first = planPull(empty, { activities: [act('A1')], efforts: [eff('T1')] }, range, {}, NOW);
    const tm = { ...first.putTimes[0], note: 'Dichtung getauscht' };
    const p = planPull({ events: first.putEvents, times: [tm] }, { activities: [act('A1')], efforts: [] }, range, first.state, NOW);
    expect(p.delTimes).toEqual([]);
  });

  it('nur Einträge mit Einsatz und Uhrzeit gehen an FSM', () => {
    const base: TimeEntry = { id: 'x', date: '2026-11-30', kind: 'arbeit', start: '07:00', end: '16:00' };
    expect(planPush([], [base], {})).toEqual([]);
    expect(planPush([], [{ ...base, kind: 'urlaub', fsm: { activityId: 'A1' } }], {})).toEqual([]);
    expect(planPush([], [{ ...base, fsm: { activityId: 'A1' } }], {})).toHaveLength(1);
    // lokale Einsätze werden nie in FSM angelegt
    expect(planPush([{ id: 'e', title: 'Einsatz', type: 'einsatz', startDate: '2026-11-30', endDate: '2026-11-30' }], [], {})).toEqual([]);
  });

  it('Demo: Zeit und Notiz gehen an FSM und kommen beim nächsten Abgleich unverändert zurück', async () => {
    const store = memStore();
    const c = demoClient(() => '2026-11-27', store);
    const r0 = await cycle(empty, {}, c);
    const ev = r0.events.find((e) => e.id === 'fsm-DEMO003')!;
    const local = { events: [...r0.events.filter((e) => e !== ev), { ...ev, notes: 'Siegelrahmen bestellt' }, { id: 'loc-1', title: 'Eigener Termin', type: 'einsatz' as const, startDate: '2026-12-02', endDate: '2026-12-02' }],
      times: [...r0.times, { id: 'loc-t', date: '2026-11-26', kind: 'kunde' as const, start: '08:00', end: '15:00', breakMin: 30, note: 'Abnahme', fsm: { activityId: 'DEMO003' } }] };
    const r1 = await cycle(local, r0.state, c);
    expect(Object.keys(store.get().efforts)).toHaveLength(1);
    expect(store.get().activities.DEMO003.remarks).toBe('Siegelrahmen bestellt');
    expect(Object.keys(store.get().activities)).toEqual(['DEMO003']); // kein neuer Einsatz in FSM
    const t = r1.times.find((x) => x.note === 'Abnahme')!;
    expect(t.id).toMatch(/^fsm-DEMO-T/);
    expect(t).toMatchObject({ start: '08:00', end: '15:00', breakMin: 30, kind: 'kunde', customer: 'Alpen Käse AG' });
    expect(r1.events.find((e) => e.id === 'loc-1')).toBeTruthy(); // eigener Termin bleibt lokal
    expect(planPush(r1.events, r1.times, r1.state)).toEqual([]);
    const r2 = await cycle(r1, r1.state, c);
    expect(r2.times.filter((x) => x.note === 'Abnahme')).toHaveLength(1);
    expect(hashTime(r2.times.find((x) => x.note === 'Abnahme')!)).toBe(hashTime(t));
    expect(hashEvent(r2.events.find((e) => e.id === 'fsm-DEMO003')!)).toBe(hashEvent({ ...ev, notes: 'Siegelrahmen bestellt' }));
  });
});
