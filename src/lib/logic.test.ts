import { describe, expect, it } from 'vitest';
import { easterSunday, holidayName } from './holidays';
import { creditedMinutes, legalBreak, overtimeBalance, summarizeDay, summarizeRange } from './time';
import { mealAllowance, tripCosts } from './travel';
import { fillTemplate, placeholders } from './templates';
import { emptyReport, fsmText, missingFields } from './report';
import { fromIcs, toIcs } from './ics';
import { DEFAULT_SETTINGS, type Settings, type TimeEntry, type Trip } from './types';

const S: Settings = { ...DEFAULT_SETTINGS, state: 'BW', overtimeStartDate: '2026-11-02' };
const work = (date: string, start: string, end: string, breakMin = 0, kind: TimeEntry['kind'] = 'arbeit'): TimeEntry =>
  ({ id: date + start, date, start, end, breakMin, kind });

describe('Feiertage', () => {
  it('berechnet Ostern', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });
  it('kennt landesspezifische Feiertage', () => {
    expect(holidayName('2026-06-04', 'BW')).toBe('Fronleichnam');
    expect(holidayName('2026-06-04', 'NI')).toBeUndefined();
    expect(holidayName('2026-11-18', 'SN')).toBe('Buß- und Bettag');
    expect(holidayName('2026-10-31', 'NI')).toBe('Reformationstag');
  });
});

describe('Arbeitszeit', () => {
  it('gesetzliche Pause nach ArbZG §4', () => {
    expect(legalBreak(6 * 60)).toBe(0);
    expect(legalBreak(6 * 60 + 15)).toBe(15);
    expect(legalBreak(8 * 60)).toBe(30);
    expect(legalBreak(9 * 60 + 40)).toBe(40);
    expect(legalBreak(11 * 60)).toBe(45);
  });
  it('zieht Mindestpause automatisch ab', () => {
    expect(creditedMinutes(work('2026-11-02', '07:00', '16:00', 0), S)).toBe(8 * 60 + 30);
    expect(creditedMinutes(work('2026-11-02', '07:00', '16:00', 60), S)).toBe(8 * 60);
  });
  it('über Mitternacht', () => {
    expect(creditedMinutes(work('2026-11-02', '22:00', '02:00'), S)).toBe(240);
  });
  it('Reisezeit-Faktor', () => {
    expect(creditedMinutes(work('2026-11-02', '06:00', '10:00', 0, 'reise'), { ...S, travelFactor: 0.5 })).toBe(120);
  });
  it('Überstunden über eine Woche (Mo 2.11.2026 – Fr 6.11.2026)', () => {
    const entries = ['02', '03', '04', '05', '06'].map((d) => work(`2026-11-${d}`, '07:00', '17:00', 45));
    const r = summarizeRange('2026-11-02', '2026-11-08', entries, S);
    expect(r.target).toBe(40 * 60);
    expect(r.actual).toBe(5 * (9 * 60 + 15));
    expect(overtimeBalance('2026-11-08', entries, S)).toBe(5 * 75);
  });
  it('Urlaub erfüllt Soll, Gleittag baut ab', () => {
    expect(summarizeDay('2026-11-02', [{ id: 'u', date: '2026-11-02', kind: 'urlaub' }], S).diff).toBe(0);
    expect(summarizeDay('2026-11-02', [{ id: 'g', date: '2026-11-02', kind: 'gleittag' }], S).diff).toBe(-480);
  });
  it('warnt bei Ruhezeit < 11 h und > 10 h', () => {
    const d = summarizeDay('2026-11-03', [work('2026-11-03', '05:00', '17:00', 45)], S, [work('2026-11-02', '08:00', '22:00', 45)]);
    expect(d.warnings.some((w) => w.includes('Ruhezeit'))).toBe(true);
    expect(d.warnings.some((w) => w.includes('10 h'))).toBe(true);
  });
});

describe('Reise', () => {
  const trip: Trip = {
    id: 't', title: 'x', customer: 'c', destination: 'd', country: 'DE', departure: '2026-11-02T06:00', return: '2026-11-04T18:00',
    transport: 'auto', km: 500, breakfasts: 2, lunches: 0, dinners: 1, checklist: [], expenses: [{ id: 'e', date: '2026-11-02', category: 'Hotel', amount: 220 }],
  };
  it('Verpflegungspauschale mehrtägig mit Kürzungen', () => {
    const m = mealAllowance(trip, S);
    expect(m.gross).toBe(14 + 28 + 14);
    expect(m.deductions).toBe(2 * 5.6 + 11.2);
    expect(m.net).toBe(33.6);
  });
  it('eintägig > 8 h', () => {
    expect(mealAllowance({ ...trip, return: '2026-11-02T15:00', breakfasts: 0, dinners: 0 }, S).net).toBe(14);
    expect(mealAllowance({ ...trip, return: '2026-11-02T13:00', breakfasts: 0, dinners: 0 }, S).net).toBe(0);
  });
  it('Gesamtkosten', () => {
    expect(tripCosts(trip, S).total).toBe(33.6 + 150 + 220);
  });
});

describe('Textvorlagen', () => {
  it('Platzhalter mit Standardwert', () => {
    const b = 'Machine {{Maschine}} checked by {{Techniker|Service}} on {{Datum}}.';
    expect(placeholders(b).map((p) => p.name)).toEqual(['Maschine', 'Techniker', 'Datum']);
    expect(fillTemplate(b, { Maschine: 'R245' })).toBe('Machine R245 checked by Service on [___].');
  });
});

describe('Servicebericht', () => {
  it('FSM-Text ohne Markdown, fehlende Felder markiert', () => {
    const r = { ...emptyReport('1'), customer: 'ACME', findings: [{ title: 'Sealing tool', text: 'Replaced heating element.' }] };
    const t = fsmText(r);
    expect(t).toContain('1. GENERAL INFORMATION');
    expect(t).toContain('Customer / site: ACME / [___]');
    expect(t).toContain('3.1 Sealing tool');
    expect(t).not.toMatch(/[*#|]/);
    expect(missingFields(r)).toContain('Site');
  });
});

describe('ICS', () => {
  it('Roundtrip', () => {
    const ics = toIcs([{ id: 'a', title: 'Einsatz, Kunde', type: 'einsatz', startDate: '2026-11-02', endDate: '2026-11-04', location: 'Wolfertschwenden' }]);
    const back = fromIcs(ics, () => 'b');
    expect(back[0]).toMatchObject({ title: 'Einsatz, Kunde', startDate: '2026-11-02', endDate: '2026-11-04', location: 'Wolfertschwenden' });
  });
});
