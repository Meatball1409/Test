import { describe, expect, it } from 'vitest';
import { applyOp, ConcurLoginError, demoConcur, gatewayClient, planPull, planTripPush, type ConcurDemoStore } from './concur';
import type { Trip } from './types';
import { bytesToBase64 } from './pdf';
import { fakeJpeg } from './testUtils';

const scan = 'data:image/jpeg;base64,' + bytesToBase64(fakeJpeg(600, 900));

const trip = (p: Partial<Trip> = {}): Trip => ({
  id: 't1', title: 'Wartung Kempten', customer: 'Musterfood', destination: 'Kempten', country: 'DE',
  departure: '2026-11-23T06:00', return: '2026-11-24T19:00', transport: 'auto', km: 320,
  breakfasts: 0, lunches: 0, dinners: 0, checklist: [],
  expenses: [{ id: 'e1', date: '2026-11-23', category: 'Hotel', amount: 119, note: '1 Nacht', receiptPages: [scan, scan] }, { id: 'e0', date: '2026-11-23', category: 'Parken', amount: 0 }],
  ...p,
});
function mem() { let st: ConcurDemoStore = { reports: {}, n: 0 }; return { load: () => structuredClone(st), save: (s: ConcurDemoStore) => { st = structuredClone(s); } }; }

describe('SAP Concur ⇄ TechDesk', () => {
  it('neue Reise: Abrechnung anlegen, Beleg mit Foto, Kilometer – Beträge 0 nicht', () => {
    const ops = planTripPush(trip());
    expect(ops.map((o) => o.kind)).toEqual(['report', 'expense', 'mileage']);
    expect(ops[0].write).toMatchObject({ name: 'Wartung Kempten', start: '2026-11-23', end: '2026-11-24' });
    expect(ops[1].write).toMatchObject({ type: 'Hotel', amount: 119, currency: 'EUR', receiptType: 'application/pdf', comment: '1 Nacht · Kunde: Musterfood' });
    const pdf = atob((ops[1].write as { receipt: string }).receipt);
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('/Count 2'); // beide gescannten Seiten in einer PDF
    expect(ops[2].write).toMatchObject({ km: 320, date: '2026-11-23' });
  });

  it('nach dem Senden ist nichts mehr offen; Änderung am Beleg wird erneut gesendet (mit ID)', () => {
    let t = trip();
    let n = 0;
    for (const op of planTripPush(t)) t = applyOp(t, op, `ID${++n}`, '2026-11-27T10:00:00Z');
    expect(t.concur).toMatchObject({ reportId: 'ID1', status: 'Entwurf', mileage: { id: 'ID3' } });
    expect(planTripPush(t)).toEqual([]);
    t = { ...t, expenses: t.expenses.map((e) => (e.id === 'e1' ? { ...e, amount: 129 } : e)) };
    const ops = planTripPush(t);
    expect(ops).toHaveLength(1);
    expect(ops[0].write).toMatchObject({ id: 'ID2', amount: 129 });
  });

  it('eingereichte Abrechnung wird nicht mehr verändert', () => {
    expect(planTripPush(trip({ concur: { reportId: 'R', status: 'Eingereicht' } }))).toEqual([]);
    expect(planTripPush(trip({ concur: { reportId: 'R', status: 'Zurückgewiesen' } })).length).toBeGreaterThan(0);
  });

  it('aus Concur: Status der Abrechnung und gebuchte Reisen (lokale Angaben bleiben)', () => {
    const local = trip({ id: 'x', concur: { itineraryId: 'IT1' }, customer: 'Alpen Käse AG' });
    const p = planPull([local, trip({ concur: { reportId: 'R1', status: 'Entwurf' } })],
      [{ id: 'R1', name: 'x', status: 'Genehmigt', total: 455.6, currency: 'EUR' }],
      [{ id: 'IT1', name: 'Lindau', start: '2026-12-01T07:00', end: '2026-12-02T18:00', destination: 'Lindau', country: 'DE', transport: 'bahn', hotel: 'Hotel See', bookingRefs: 'DB 123' },
       { id: 'IT2', name: 'Lyon', start: '2026-12-07T07:05', end: '2026-12-11T21:40', destination: 'Lyon', country: 'FR', transport: 'flug' }], 'now');
    const byId = Object.fromEntries(p.put.map((t) => [t.id, t]));
    expect(byId.x).toMatchObject({ customer: 'Alpen Käse AG', hotel: 'Hotel See', departure: '2026-12-01T07:00', transport: 'auto' });
    expect(byId.t1.concur).toMatchObject({ status: 'Genehmigt', total: 455.6 });
    expect(byId['concur-IT2']).toMatchObject({ title: 'Lyon', country: 'FR', transport: 'flug', expenses: [] });
    expect(p.events.map((e) => e.id)).toEqual(['trip-x', 'trip-concur-IT2']);
  });

  it('Schnittstelle der IT: Anmeldung über Firmen-Login, eigene Daten', async () => {
    const calls: [string, RequestInit][] = [];
    const ok = gatewayClient('https://gw.example/concur/', (async (u: string, i: RequestInit) => { calls.push([u, i]); return new Response(JSON.stringify({ id: 'E9' }), { status: 200 }); }) as unknown as typeof fetch);
    expect(await ok.saveExpense({ id: 'E9', reportId: 'R/1', date: '2026-11-23', type: 'Hotel', amount: 1, currency: 'EUR', comment: '' })).toBe('E9');
    expect(calls[0][0]).toBe('https://gw.example/concur/me/reports/R%2F1/expenses/E9');
    expect(calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'include' });
    expect(JSON.parse(String(calls[0][1].body))).not.toHaveProperty('reportId');
    const no = gatewayClient('https://gw.example/concur', (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    await expect(no.reports()).rejects.toBeInstanceOf(ConcurLoginError);
  });

  it('Demo: gesendete Reise erscheint als Abrechnung mit Summe', async () => {
    const c = demoConcur(() => '2026-11-27', mem());
    let t = trip();
    for (const op of planTripPush(t)) {
      const id = op.kind === 'report' ? await c.createReport(op.write) : op.kind === 'expense' ? await c.saveExpense({ ...op.write, reportId: t.concur!.reportId! }) : await c.saveMileage({ ...op.write, reportId: t.concur!.reportId! });
      t = applyOp(t, op, id, 'now');
    }
    const reps = await c.reports();
    expect(reps.find((r) => r.id === t.concur!.reportId)).toMatchObject({ status: 'Entwurf', total: 119 + 96 });
    expect(reps.some((r) => r.status === 'Bezahlt')).toBe(true);
    expect((await c.itineraries('2026-11-01', '2027-01-31')).map((i) => i.id)).toEqual(['IT-DEMO-1', 'IT-DEMO-2']);
  });
});
