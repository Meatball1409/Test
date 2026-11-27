import { describe, expect, it } from 'vitest';
import { easterSunday, holidayName } from './holidays';
import { parseHours } from './dates';
import { breakLabel, creditedMinutes, legalBreak, overtimeBalance, summarizeDay, summarizeRange } from './time';
import { mealAllowance, tripCosts } from './travel';
import { fillTemplate, placeholders } from './templates';
import { emptyReport, fsmText, missingFields } from './report';
import { fromIcs, toIcs } from './ics';
import { DEFAULT_SETTINGS, type Settings, type TimeEntry, type Trip } from './types';

const S: Settings = { ...DEFAULT_SETTINGS, state: 'BW', overtimeStartDate: '2026-11-02', breakMode: 'gesetzlich', glzCapMin: 0 };
const F: Settings = { ...S, breakMode: 'firma' };
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
  it('warnt bei Ruhezeit < 11 h, aber nicht bei mehr als 10 h', () => {
    const d = summarizeDay('2026-11-03', [work('2026-11-03', '05:00', '17:00', 45)], S, [work('2026-11-02', '08:00', '22:00', 45)]);
    expect(d.warnings.some((w) => w.includes('Ruhezeit'))).toBe(true);
    expect(d.warnings.some((w) => w.includes('10 h'))).toBe(false);
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

import { adapter, allowance, checkLink, entriesFor, isDomestic, safety, search } from './visa';
describe('Visa-Kompass', () => {
  it('Adapter nach Steckertyp', () => {
    expect(adapter('C,F').tone).toBe('ok');
    expect(adapter('A,B').text).toBe('Nötig (Typ A/B)');
    expect(adapter('C,G').tone).toBe('warn');
  });
  it('Sicherheitsstufe', () => {
    expect(safety('Ukraine').tone).toBe('bad');
    expect(safety('Thailand').tone).toBe('warn');
    expect(safety('Kanada').tone).toBe('ok');
  });
  it('Link-Prüfung', () => {
    expect(checkLink('https://esta.cbp.dhs.gov/')?.tone).toBe('ok');
    expect(checkLink('esta-usa-online.com/apply')?.tone).toBe('bad');
    expect(checkLink('')).toBeUndefined();
  });
  it('Suche und Länder-Einträge', () => {
    expect(search('bali', 'all', new Set()).length).toBe(2);
    expect(entriesFor('USA')[0].what).toBe('ESTA');
    expect(entriesFor('Bali').length).toBe(2);
  });
  it('BMF-Pauschalen', () => {
    expect(allowance('USA')).toMatchObject({ full: 59, partial: 40 });
    expect(allowance('USA')!.cities[0]).toMatchObject({ name: 'New York City', full: 66, partial: 44 });
    expect(isDomestic('DE')).toBe(true);
  });
});

describe('Firmen-Pausenregel (45 min ab 8 h)', () => {
  it('7:00–18:00 → 10:15', () => {
    expect(creditedMinutes(work('2026-11-02', '07:00', '18:00'), F)).toBe(10 * 60 + 15);
    expect(breakLabel(work('2026-11-02', '07:00', '18:00'), F)).toBe('Pause 12:00–12:45');
  });
  it('genau 8 h → Abzug, darunter nicht', () => {
    expect(creditedMinutes(work('2026-11-02', '07:00', '15:00'), F)).toBe(7 * 60 + 15);
    expect(creditedMinutes(work('2026-11-02', '07:00', '14:59'), F)).toBe(7 * 60 + 59);
  });
  it('eingetragene Pause wird ignoriert, Reisezeit ohne Abzug', () => {
    expect(creditedMinutes(work('2026-11-02', '07:00', '18:00', 90), F)).toBe(10 * 60 + 15);
    expect(creditedMinutes(work('2026-11-02', '06:00', '15:00', 0, 'reise'), F)).toBe(9 * 60);
  });
  it('keine Pausen-Warnung bei Firmenregel', () => {
    const d = summarizeDay('2026-11-03', [work('2026-11-03', '07:00', '14:30')], F);
    expect(d.warnings).toEqual([]);
  });
});

describe('Überstundenstand eingeben', () => {
  it('parseHours', () => {
    expect(parseHours('23:15')).toBe(1395);
    expect(parseHours('-4:30')).toBe(-270);
    expect(parseHours('+12')).toBe(720);
    expect(parseHours('12,5')).toBe(750);
    expect(parseHours('−1:05')).toBe(-65);
    expect(parseHours('abc')).toBeNull();
  });
  it('Stand ab Stichtag plus Einträge', () => {
    const s2: Settings = { ...F, overtimeStartDate: '2026-11-23', overtimeStartBalance: 1395 };
    // Mo 23.11. 7–18 = 10:15 → +2:15
    expect(overtimeBalance('2026-11-23', [work('2026-11-23', '07:00', '18:00')], s2)).toBe(1395 + 135);
  });
});

import { halfDayName, holidays } from './holidays';
import { fmtHours, glzAccount, vacationSummary, withCalendarVacation } from './time';
describe('Bayern: Feiertage und Urlaub', () => {
  const BY: Settings = { ...DEFAULT_SETTINGS, breakMode: 'firma', overtimeStartDate: '2026-01-01' };
  it('Standard-Bundesland ist Bayern, 30 Urlaubstage', () => {
    expect(DEFAULT_SETTINGS.state).toBe('BY');
    expect(DEFAULT_SETTINGS.vacationDaysPerYear).toBe(30);
  });
  it('alle Feiertage Bayern 2026', () => {
    expect([...holidays(2026, 'BY').entries()].sort()).toEqual([
      ['2026-01-01', 'Neujahr'], ['2026-01-06', 'Heilige Drei Könige'], ['2026-04-03', 'Karfreitag'], ['2026-04-06', 'Ostermontag'],
      ['2026-05-01', 'Tag der Arbeit'], ['2026-05-14', 'Christi Himmelfahrt'], ['2026-05-25', 'Pfingstmontag'], ['2026-06-04', 'Fronleichnam'],
      ['2026-08-15', 'Mariä Himmelfahrt'], ['2026-10-03', 'Tag der Deutschen Einheit'], ['2026-11-01', 'Allerheiligen'],
      ['2026-12-25', '1. Weihnachtstag'], ['2026-12-26', '2. Weihnachtstag'],
    ]);
    expect(halfDayName('2026-12-24')).toBe('Heiligabend (½ Tag)');
  });
  it('Urlaubskonto: 30 − ½ − ½ − Urlaub (nur Arbeitstage)', () => {
    // Urlaub Mo 3.8.–Fr 14.8. = 10 Arbeitstage (Kalender), dazu 1 Tag aus der Zeiterfassung
    const events = [{ id: 'u', title: 'Sommerurlaub', type: 'urlaub' as const, startDate: '2026-08-03', endDate: '2026-08-16' }];
    const times: TimeEntry[] = [{ id: 'z', date: '2026-02-16', kind: 'urlaub' }];
    const v = vacationSummary(2026, times, events, BY, '2026-11-26');
    expect(v.halfTotal).toBe(1);
    expect(v.taken).toBe(11);
    expect(v.planned).toBe(1); // 24./31.12. liegen noch in der Zukunft
    expect(v.rest).toBe(19);
    expect(v.remaining).toBe(18);
  });
  it('Urlaub über Weihnachten: 24./31.12. kosten nur die zweite Hälfte, Feiertage nichts', () => {
    const events = [{ id: 'w', title: 'Weihnachten', type: 'urlaub' as const, startDate: '2026-12-21', endDate: '2027-01-06' }];
    const v = vacationSummary(2026, [], events, BY, '2026-11-26');
    // 21.–23.12. (3) + 24.12. (½+½) + 28.–30.12. (3) + 31.12. (½+½) = 8 inkl. der automatischen halben Tage; 25./26.12. Feiertage
    expect(v.planned).toBe(8);
    expect(v.remaining).toBe(30 - 8);
  });
  it('Zeiterfassung: 24.12. halbes Soll erfüllt, Kalender-Urlaub erfüllt Soll', () => {
    expect(summarizeDay('2026-12-24', [], BY).diff).toBe(-240);
    const t = withCalendarVacation([], [{ id: 'u', title: 'U', type: 'urlaub', startDate: '2026-12-22', endDate: '2026-12-22' }]);
    expect(summarizeDay('2026-12-22', t, BY).diff).toBe(0);
  });
});

describe('Resturlaub aus dem Vorjahr', () => {
  it('Übertrag erhöht den Anspruch nur im eingetragenen Jahr', () => {
    const S2: Settings = { ...DEFAULT_SETTINGS, vacationCarryOver: { '2026': 4.5 } };
    const v = vacationSummary(2026, [], [], S2, '2026-11-26');
    expect(v.carryOver).toBe(4.5);
    expect(v.entitlement).toBe(34.5);
    expect(v.remaining).toBe(33.5);
    expect(v.rest).toBe(34.5);
    expect(vacationSummary(2027, [], [], S2, '2026-11-26').carryOver).toBe(0);
  });
});

describe('Auswertung wie SAP-Zeitnachweis (Oktober 2026)', () => {
  const Z: Settings = { ...DEFAULT_SETTINGS, state: 'BY', breakMode: 'firma', travelFactor: 1, glzCapMin: 150 * 60, separateSunHoliday: true, overtimeStartDate: '2026-10-26', overtimeStartBalance: 150 * 60 };
  const seg = (date: string, kind: TimeEntry['kind'], start: string, end: string): TimeEntry => ({ id: date + start + kind, date, kind, start, end });
  // KW 44 laut Zeitnachweis
  const week: TimeEntry[] = [
    seg('2026-10-26', 'reise', '07:30', '08:00'), seg('2026-10-26', 'kunde', '08:00', '12:00'), seg('2026-10-26', 'kunde', '12:45', '15:15'), seg('2026-10-26', 'kunde', '15:15', '15:45'),
    seg('2026-10-27', 'reise', '07:30', '08:00'), seg('2026-10-27', 'kunde', '08:00', '12:00'), seg('2026-10-27', 'kunde', '12:45', '17:00'), seg('2026-10-27', 'reise', '17:00', '17:30'),
    seg('2026-10-28', 'reise', '07:30', '09:00'), seg('2026-10-28', 'kunde', '09:00', '12:00'), seg('2026-10-28', 'kunde', '12:45', '17:00'), seg('2026-10-28', 'reise', '17:00', '18:30'),
    seg('2026-10-29', 'reise', '09:00', '12:00'), seg('2026-10-29', 'reise', '12:45', '17:00'),
    seg('2026-10-30', 'reise', '08:45', '09:00'), seg('2026-10-30', 'kunde', '09:00', '12:00'), seg('2026-10-30', 'kunde', '12:45', '19:00'), seg('2026-10-30', 'reise', '19:00', '19:15'),
    seg('2026-10-31', 'reise', '07:45', '08:00'), seg('2026-10-31', 'kunde', '08:00', '12:00'), seg('2026-10-31', 'kunde', '12:45', '17:00'), seg('2026-10-31', 'reise', '17:00', '17:15'),
  ];
  it('Tagesstunden je Tag (Lücke 12:00–12:45 = Pause, kein zweiter Abzug)', () => {
    const r = summarizeRange('2026-10-26', '2026-10-31', week, Z);
    expect(r.days.map((d) => d.worked / 60)).toEqual([7.5, 9.25, 10.25, 7.25, 9.75, 8.75]);
    expect(r.days.map((d) => d.diff / 60)).toEqual([-0.5, 1.25, 2.25, -0.75, 1.75, 8.75]);
  });
  it('Wochensumme 52,75 / Soll 40 / Saldo 12,75, Samstag 8,75 als 25 %-Stunden', () => {
    const r = summarizeRange('2026-10-26', '2026-10-31', week, Z);
    expect(r.worked / 60).toBe(52.75);
    expect(r.target / 60).toBe(40);
    expect(r.diff / 60).toBe(12.75);
    expect(r.sat / 60).toBe(8.75);
  });
  it('Sonntag zählt nicht zum Saldo, sondern separat', () => {
    const d = summarizeDay('2026-10-25', [seg('2026-10-25', 'kunde', '06:00', '22:00')], Z);
    expect(d.worked / 60).toBe(15.25);
    expect(d.diff).toBe(0);
    expect(d.sun / 60).toBe(15.25);
    expect(d.paidSeparately / 60).toBe(15.25);
  });
  it('Gleitzeitkonto: Obergrenze 150, Überschuss separat', () => {
    const g = glzAccount('2026-10-31', week, Z);
    expect(g.previous / 60).toBe(150);
    expect(g.periodSaldo / 60).toBe(12.75);
    expect(g.balance / 60).toBe(150);
    expect(g.overCap / 60).toBe(12.75);
  });
  it('einfache Eingabe 7–18 Uhr ohne Lücke: 45 min Abzug', () => {
    expect(summarizeDay('2026-11-02', [seg('2026-11-02', 'arbeit', '07:00', '18:00')], Z).worked).toBe(615);
  });
  it('Dezimal-Anzeige', () => {
    expect(fmtHours(570, Z)).toBe('9,50');
    expect(fmtHours(-45, Z, true)).toBe('−0,75');
    expect(fmtHours(150 * 60, { hourFormat: 'hm' })).toBe('150:00');
  });
});

describe('Gleitzeitrahmen −150 bis +150', () => {
  it('Überschuss wird ausgezahlt (+25 %), Konto bleibt bei 150; Minus bleibt erhalten', () => {
    const G: Settings = { ...DEFAULT_SETTINGS, overtimeStartDate: '2026-11-02', overtimeStartBalance: 148 * 60 };
    const e: TimeEntry[] = [{ id: 'a', date: '2026-11-02', kind: 'arbeit', start: '06:00', end: '19:45' }]; // 13:00 → +5:00
    const g = glzAccount('2026-11-02', e, G);
    expect(g.balance / 60).toBe(150);
    expect(g.overCap / 60).toBe(3);
    expect(DEFAULT_SETTINGS.glzFloorMin / 60).toBe(-150);
    expect(DEFAULT_SETTINGS.overPayPct).toBe(25);
    const neg = glzAccount('2026-11-02', [], { ...G, overtimeStartBalance: -149 * 60 });
    expect(neg.balance / 60).toBe(-157); // Minus wird nicht gekappt (Warnung in der App)
  });
});

describe('Nachtstunden wie Überstunden (25 %)', () => {
  const N: Settings = { ...DEFAULT_SETTINGS, overtimeStartDate: '2026-11-02', overtimeStartBalance: 0 };
  it('Nachtanteil geht nicht ins Gleitzeitkonto, wird separat ausgewiesen', () => {
    // Mo 14:00–24:00 = 10 h, 45 min Pause → 9,25 h; davon 2 h Nacht (22–24)
    const d = summarizeDay('2026-11-02', [{ id: 'n', date: '2026-11-02', kind: 'arbeit', start: '14:00', end: '00:00' }], N);
    expect(d.worked / 60).toBe(9.25);
    expect(d.nightPaid / 60).toBe(2);
    expect(d.diff / 60).toBe(9.25 - 2 - 8);
  });
  it('Schicht über Mitternacht 20:00–04:00', () => {
    const d = summarizeDay('2026-11-03', [{ id: 'm', date: '2026-11-03', kind: 'arbeit', start: '20:00', end: '04:00' }], N);
    expect(d.nightPaid / 60).toBe(6);
  });
  it('abschaltbar', () => {
    const d = summarizeDay('2026-11-02', [{ id: 'n', date: '2026-11-02', kind: 'arbeit', start: '14:00', end: '00:00' }], { ...N, nightSeparate: false });
    expect(d.nightPaid).toBe(0);
    expect(d.diff / 60).toBe(1.25);
  });
});

import { parseSapStatement, sapNum, sapToEntries } from './sapImport';
describe('SAP-Zeitnachweis importieren', () => {
  const lines = [
    'Zeitnachweis', 'vom 01.10.2026 bis 31.10.2026', '26.11.2026 Seite 3/3',
    'Tag von bis Std. Sollz Saldo Summe UM TAZP',
    '01 DO Urlaub 8,00 8,00 0,00 150,00 0,00 MES9',
    '25 SO Kundenbesuch 06:00 12:00 15,25 0,00 0,00 153,00 0,00 FRKD',
    'Kundenbesuch 12:45 22:00',
    'Überstund.Sonnt. ZVB 15,25', 'Sonntag 50% ZVB 15,25',
    'Wochensumme : 19.10.2026 - 25.10.2026 55,25 40,00 0,00 0,00',
    '26 MO Reisezeit 07:30 08:00 7,50 8,00 0,50- 153,50 0,00 MES9',
    'Kundenbesuch 08:00 12:00', 'Kundenbesuch 12:45 15:15', 'Kundenbesuch 15:15 15:45',
    '27 DI Reisezeit 07:30 08:00 9,25 8,00 1,25 154,75 0,00 MES9',
    'Kundenbesuch 08:00 12:00', 'Kundenbesuch 12:45 17:00', 'Reisezeit 17:00 17:30',
    '28 MI Auslandsdienstreise a. RK 06:00 14:00 10,25 8,00 2,25 157,00 0,00 MES9',
    'Reisezeit 07:30 09:00', 'Kundenbesuch 09:00 12:00', 'Kundenbesuch 12:45 17:00', 'Reisezeit 17:00 18:30',
    '29 DO Auslandsdienstreise a. RK 06:00 14:00 7,25 8,00 0,75- 156,25 0,00 MES9',
    'Reisezeit 09:00 12:00', 'Reisezeit 12:45 17:00',
    '30 FR Auslandsdienstreise a. RK 06:00 14:00 9,75 8,00 1,75 158,00 0,00 MES9',
    'Reisezeit 08:45 09:00', 'Kundenbesuch 09:00 12:00', 'Kundenbesuch 12:45 19:00', 'Reisezeit 19:00 19:15',
    '31 SA Auslandsdienstreise a. RK 00:00 00:00 8,75 0,00 8,75 166,75 0,00 FRKD',
    'Reisezeit 07:45 08:00', 'Kundenbesuch 08:00 12:00', 'Kundenbesuch 12:45 17:00', 'Reisezeit 17:00 17:15',
    'Überstund. 25% ZVB 8,75', 'Gleitzeitstd. 125% ZVB 16,75', 'CO:geleist.Std. 208,00',
    'Wochensumme : 26.10.2026 - 31.10.2026 52,75 40,00 12,75 0,00',
    'Monats-Summe 208,00 176,00 150,00 0,00',
    'Monatsübersicht zum Stichtag 31.10.2026',
    'Zeitkonto Anzahl Zeitkonto Anzahl',
    'GLZ-Saldo Vorperiode 150,00 Überstunden 0,00',
    'GLZ-Saldo Gesamt 150,00 Überstunden 25% 8,75',
    'Gleitzeitstunden 125% 16,75 0,50-Euro-Schicht 0,00',
    'Abwesenheitsansprüche zum Stichtag 31.10.2026',
    'Zeitkonto Abtragbar bis Anspruch Rest Verplant Verbrauch',
    'Tarifurlaub 31.12.2026 30,00 8,00 8,00 22,00',
  ];
  const st = parseSapStatement(lines);
  it('Kopf, Konten und Urlaub', () => {
    expect(st.from).toBe('2026-10-01');
    expect(st.to).toBe('2026-10-31');
    expect(st.stichtag).toBe('2026-10-31');
    expect(st.glzTotal).toBe(150 * 60);
    expect(st.glzPrevious).toBe(150 * 60);
    expect(st.overCapPaid! / 60).toBe(16.75);
    expect(st.vacation).toEqual({ until: '2026-12-31', entitlement: 30, rest: 8, planned: 8, used: 22 });
    expect(sapNum('0,50-')).toBe(-30);
  });
  it('Tage und Abschnitte; Tagesart „Auslandsdienstreise 06:00–14:00“ ist kein Abschnitt', () => {
    const d28 = st.days.find((d) => d.date === '2026-10-28')!;
    expect(d28.label).toBe('Auslandsdienstreise a. RK');
    expect(d28.segments.map((x) => `${x.kind} ${x.start}-${x.end}`)).toEqual(['reise 07:30-09:00', 'kunde 09:00-12:00', 'kunde 12:45-17:00', 'reise 17:00-18:30']);
    expect(d28.std! / 60).toBe(10.25);
    const d26 = st.days.find((d) => d.date === '2026-10-26')!;
    expect(d26.segments[0]).toMatchObject({ kind: 'reise', start: '07:30', end: '08:00' });
    expect(d26.saldo).toBe(-30);
    expect(st.days.find((d) => d.date === '2026-10-01')!.absence).toBe('urlaub');
    expect(st.unknown).toEqual([]);
  });
  it('importierte Abschnitte ergeben dieselben Tagesstunden wie SAP', () => {
    const Z: Settings = { ...DEFAULT_SETTINGS, travelFactor: 1, breakMode: 'firma' };
    const entries = sapToEntries(st);
    for (const d of st.days.filter((x) => x.segments.length)) {
      const calc = summarizeDay(d.date, entries.filter((e) => e.date === d.date), Z).worked;
      expect([d.date, calc / 60]).toEqual([d.date, d.std! / 60]);
    }
    expect(entries.find((e) => e.date === '2026-10-01')).toMatchObject({ kind: 'urlaub', id: 'sap-2026-10-01-a' });
  });
});

import { activityToEvent, demoData, effortToEntry } from './fsm';
describe('FSM-Anbindung (Demo + Abbildung)', () => {
  const { activities, efforts } = demoData('2026-11-27');
  it('Demo-Einsätze rund um heute, vergangene mit Zeitbuchungen', () => {
    expect(activities.length).toBe(6);
    expect(activities.filter((a) => a.status === 'CLOSED').length).toBe(4); // Freitag: Mo–Mi dieser Woche schon erledigt
    expect(efforts.length).toBeGreaterThan(0);
    expect(efforts.every((t) => t.start < '2026-11-27')).toBe(true);
  });
  it('Einsatz → Kalendertermin, Zeitbuchung → Abschnitt', () => {
    const ev = activityToEvent(activities[2]);
    expect(ev).toMatchObject({ id: 'fsm-DEMO003', type: 'einsatz', customer: 'Alpen Käse AG', startTime: '08:00' });
    const te = effortToEntry(efforts[0], activities);
    expect(te.id.startsWith('fsm-')).toBe(true);
    expect(te.kind).toBe('reise');
    expect(te.note).toMatch(/^FSM A-26/);
  });
  it('Demo-Zeiten ergeben plausible Tage (mit Lücke 12:00–12:45 als Pause)', () => {
    const entries = efforts.map((t) => effortToEntry(t, activities));
    const d = summarizeDay(entries[0].date, entries.filter((e) => e.date === entries[0].date), { ...DEFAULT_SETTINGS, travelFactor: 1 });
    expect(d.worked / 60).toBe(10.25); // 06:30–17:30 mit 45 min Lücke
    expect(d.breakDeducted).toBe(0);
  });
});
