import { addDays, pad, toISODate } from './dates';

export const STATES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg',
  HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
} as const;
export type StateCode = keyof typeof STATES;

/** Ostersonntag (Gregorianischer Kalender, anonymer Algorithmus) */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Buß- und Bettag: Mittwoch vor dem 23. November */
function bussUndBettag(year: number): string {
  const d = new Date(year, 10, 22);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return toISODate(d);
}

type Rule = { name: string; date: (y: number) => string; states?: StateCode[] };
const fixed = (m: number, d: number) => (y: number) => `${y}-${pad(m)}-${pad(d)}`;
const easter = (offset: number) => (y: number) => addDays(easterSunday(y), offset);

const RULES: Rule[] = [
  { name: 'Neujahr', date: fixed(1, 1) },
  { name: 'Heilige Drei Könige', date: fixed(1, 6), states: ['BW', 'BY', 'ST'] },
  { name: 'Internationaler Frauentag', date: fixed(3, 8), states: ['BE', 'MV'] },
  { name: 'Karfreitag', date: easter(-2) },
  { name: 'Ostersonntag', date: easter(0), states: ['BB'] },
  { name: 'Ostermontag', date: easter(1) },
  { name: 'Tag der Arbeit', date: fixed(5, 1) },
  { name: 'Christi Himmelfahrt', date: easter(39) },
  { name: 'Pfingstsonntag', date: easter(49), states: ['BB'] },
  { name: 'Pfingstmontag', date: easter(50) },
  { name: 'Fronleichnam', date: easter(60), states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'] },
  { name: 'Mariä Himmelfahrt', date: fixed(8, 15), states: ['SL'] },
  { name: 'Weltkindertag', date: fixed(9, 20), states: ['TH'] },
  { name: 'Tag der Deutschen Einheit', date: fixed(10, 3) },
  { name: 'Reformationstag', date: fixed(10, 31), states: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'] },
  { name: 'Allerheiligen', date: fixed(11, 1), states: ['BW', 'BY', 'NW', 'RP', 'SL'] },
  { name: 'Buß- und Bettag', date: bussUndBettag, states: ['SN'] },
  { name: '1. Weihnachtstag', date: fixed(12, 25) },
  { name: '2. Weihnachtstag', date: fixed(12, 26) },
];

/** Map ISO-Datum → Feiertagsname für ein Jahr und Bundesland */
export function holidays(year: number, state: StateCode): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of RULES) if (!r.states || r.states.includes(state)) map.set(r.date(year), r.name);
  return map;
}

const cache = new Map<string, Map<string, string>>();
export function holidayName(iso: string, state: StateCode): string | undefined {
  const year = Number(iso.slice(0, 4));
  const key = `${year}-${state}`;
  if (!cache.has(key)) cache.set(key, holidays(year, state));
  return cache.get(key)!.get(iso);
}
