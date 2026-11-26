import { eachDay, timeToMinutes, weekday } from './dates';
import { holidayName } from './holidays';
import type { Settings, TimeEntry } from './types';

/** Bruttodauer zwischen Start und Ende, Ende vor Start = über Mitternacht */
export function grossMinutes(start?: string, end?: string): number {
  if (!start || !end) return 0;
  let d = timeToMinutes(end) - timeToMinutes(start);
  if (d < 0) d += 24 * 60;
  return d;
}

/** Gesetzliche Mindestpause nach §4 ArbZG */
export function legalBreak(grossMin: number): number {
  // Pause zählt nicht zur Arbeitszeit: entscheidend ist, ob netto > 6 h bzw. > 9 h gearbeitet wird.
  if (grossMin > 9 * 60 + 45) return 45;
  if (grossMin > 9 * 60 + 30) return 30 + (grossMin - (9 * 60 + 30));
  if (grossMin > 6 * 60 + 30) return 30;
  if (grossMin > 6 * 60) return grossMin - 6 * 60;
  return 0;
}

export function effectiveBreak(e: TimeEntry, s: Settings): number {
  const entered = e.breakMin ?? 0;
  if (e.kind !== 'arbeit' || !s.autoLegalBreak) return entered;
  return Math.max(entered, legalBreak(grossMinutes(e.start, e.end)));
}

/** Angerechnete Minuten eines Eintrags (ohne Abwesenheiten) */
export function creditedMinutes(e: TimeEntry, s: Settings): number {
  const net = Math.max(0, grossMinutes(e.start, e.end) - effectiveBreak(e, s));
  switch (e.kind) {
    case 'arbeit': return net;
    case 'reise': return Math.round(net * s.travelFactor);
    case 'bereitschaft': return Math.round(net * s.standbyFactor);
    default: return 0;
  }
}

export function isWorkday(iso: string, s: Settings): boolean {
  return s.workDays.includes(weekday(iso)) && !holidayName(iso, s.state);
}

export function dailyTarget(iso: string, s: Settings): number {
  if (!isWorkday(iso, s) || s.workDays.length === 0) return 0;
  return Math.round((s.weeklyHours * 60) / s.workDays.length);
}

export interface DaySummary {
  date: string;
  target: number;
  actual: number;
  diff: number;
  absence?: string;
  holiday?: string;
  warnings: string[];
}

const ABSENCE = new Set(['urlaub', 'krank']);

export function summarizeDay(date: string, entries: TimeEntry[], s: Settings, prevDayEntries: TimeEntry[] = []): DaySummary {
  const target = dailyTarget(date, s);
  const holiday = holidayName(date, s.state);
  const absenceEntry = entries.find((e) => ABSENCE.has(e.kind));
  const warnings: string[] = [];
  let actual = entries.reduce((sum, e) => sum + creditedMinutes(e, s), 0);
  // Urlaub/Krank: Soll gilt als erfüllt. Gleittag: kein Gutschrift → Überstunden werden abgebaut.
  if (absenceEntry) actual += target;

  const workNet = entries.filter((e) => e.kind === 'arbeit')
    .reduce((sum, e) => sum + Math.max(0, grossMinutes(e.start, e.end) - effectiveBreak(e, s)), 0);
  if (workNet > 10 * 60) warnings.push('Mehr als 10 h Arbeitszeit (§3 ArbZG)');
  for (const e of entries) {
    if (e.kind === 'arbeit' && (e.breakMin ?? 0) < legalBreak(grossMinutes(e.start, e.end)))
      warnings.push(`Pause unter gesetzlichem Minimum (${legalBreak(grossMinutes(e.start, e.end))} min)`);
  }
  const lastEnd = latestEnd(prevDayEntries);
  const firstStart = earliestStart(entries);
  if (lastEnd !== undefined && firstStart !== undefined) {
    const rest = 24 * 60 - lastEnd + firstStart;
    if (rest < 11 * 60) warnings.push(`Ruhezeit nur ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} h (§5 ArbZG: 11 h)`);
  }
  if (entries.length > 0 && (weekday(date) === 0 || holiday)) warnings.push(holiday ? `Arbeit am Feiertag (${holiday})` : 'Sonntagsarbeit');

  return { date, target, actual, diff: actual - target, absence: absenceEntry?.kind, holiday, warnings: [...new Set(warnings)] };
}

function workTimes(entries: TimeEntry[]) {
  return entries.filter((e) => (e.kind === 'arbeit' || e.kind === 'reise') && e.start && e.end);
}
function latestEnd(entries: TimeEntry[]): number | undefined {
  const ends = workTimes(entries).map((e) => {
    const s = timeToMinutes(e.start!), en = timeToMinutes(e.end!);
    return en < s ? undefined : en; // über Mitternacht → Ruhezeit nicht sinnvoll prüfbar
  }).filter((x): x is number => x !== undefined);
  return ends.length ? Math.max(...ends) : undefined;
}
function earliestStart(entries: TimeEntry[]): number | undefined {
  const st = workTimes(entries).map((e) => timeToMinutes(e.start!));
  return st.length ? Math.min(...st) : undefined;
}

export interface RangeSummary { days: DaySummary[]; target: number; actual: number; diff: number }

export function summarizeRange(from: string, to: string, all: TimeEntry[], s: Settings): RangeSummary {
  const byDate = new Map<string, TimeEntry[]>();
  for (const e of all) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }
  const days: DaySummary[] = [];
  let prev: TimeEntry[] = [];
  for (const d of eachDay(from, to)) {
    const entries = byDate.get(d) ?? [];
    days.push(summarizeDay(d, entries, s, prev));
    prev = entries;
  }
  const target = days.reduce((a, d) => a + d.target, 0);
  const actual = days.reduce((a, d) => a + d.actual, 0);
  return { days, target, actual, diff: actual - target };
}

/** Überstundenkonto bis einschließlich `until` */
export function overtimeBalance(until: string, all: TimeEntry[], s: Settings): number {
  if (until < s.overtimeStartDate) return s.overtimeStartBalance;
  return s.overtimeStartBalance + summarizeRange(s.overtimeStartDate, until, all, s).diff;
}

export function vacationUsed(year: number, all: TimeEntry[], s: Settings): number {
  const days = new Set(all.filter((e) => e.kind === 'urlaub' && e.date.startsWith(String(year)) && isWorkday(e.date, s)).map((e) => e.date));
  return days.size;
}
