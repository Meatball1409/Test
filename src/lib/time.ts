import { addDays, eachDay, formatMinutes, timeToMinutes, weekday } from './dates';
import { halfDayName, holidayName } from './holidays';
import type { CalendarEvent } from './types';
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

const WORK = new Set(['arbeit', 'kunde']);
/** Pause eines einzelnen Eintrags (wenn er allein steht) – für die Anzeige im Eingabefenster */
export function effectiveBreak(e: TimeEntry, s: Settings): number {
  const entered = e.breakMin ?? 0;
  if (!WORK.has(e.kind)) return entered;
  const gross = grossMinutes(e.start, e.end);
  if (s.breakMode === 'firma') return gross >= s.companyBreakFromMin ? s.companyBreakMin : 0;
  if (s.breakMode === 'gesetzlich') return Math.max(entered, legalBreak(gross));
  return entered;
}

/** Anzeige der Pause, z. B. „12:00–12:45“ bei der Firmenregel */
export function breakLabel(e: TimeEntry, s: Settings): string {
  const b = effectiveBreak(e, s);
  if (!b) return 'keine Pause';
  if (s.breakMode !== 'firma') return `${b} min Pause`;
  const st = timeToMinutes(s.companyBreakStart) + b;
  return `Pause ${s.companyBreakStart}–${String(Math.floor(st / 60)).padStart(2, '0')}:${String(st % 60).padStart(2, '0')}`;
}

/** Angerechnete Minuten eines Eintrags (ohne Abwesenheiten) */
export function creditedMinutes(e: TimeEntry, s: Settings): number {
  const net = Math.max(0, grossMinutes(e.start, e.end) - effectiveBreak(e, s));
  switch (e.kind) {
    case 'arbeit': case 'kunde': return net;
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

/** Abschnitte eines Tages als Intervalle (Minuten ab 0:00, über Mitternacht > 1440) */
function intervals(entries: TimeEntry[], kinds: Set<string>) {
  return entries.filter((e) => kinds.has(e.kind) && e.start && e.end).map((e) => {
    const a = timeToMinutes(e.start!);
    let b = timeToMinutes(e.end!);
    if (b <= a) b += 24 * 60;
    return { a, b, kind: e.kind };
  }).sort((x, y) => x.a - y.a);
}
function unionLength(iv: { a: number; b: number }[]): number {
  let total = 0, curA = -1, curB = -1;
  for (const { a, b } of iv) {
    if (a > curB) { if (curB > curA) total += curB - curA; curA = a; curB = b; }
    else curB = Math.max(curB, b);
  }
  if (curB > curA) total += curB - curA;
  return total;
}
function overlap(a: number, b: number, from: number, to: number) { return Math.max(0, Math.min(b, to) - Math.max(a, from)); }

export interface DayWork {
  worked: number; // angerechnete Minuten (Arbeit/Kunde/Reise inkl. Faktor, Bereitschaft mit Faktor, nach Pause)
  breakDeducted: number;
  gaps: number; // bereits eingetragene Lücken (z. B. 12:00–12:45)
  first?: number;
  last?: number;
  night: number;
}

/**
 * Tagesberechnung wie im Zeitnachweis: Alle Abschnitte (Arbeit, Kundenbesuch, Reise) ergeben die Anwesenheit.
 * Lücken zwischen den Abschnitten gelten als Pause. Nur wenn die Lücken kürzer als die Pflichtpause sind,
 * wird der Rest automatisch abgezogen (Firmenregel: 45 min ab 8 h Anwesenheit).
 */
export function dayWork(entries: TimeEntry[], s: Settings): DayWork {
  const iv = intervals(entries, new Set(['arbeit', 'kunde', 'reise']));
  const standby = entries.filter((e) => e.kind === 'bereitschaft').reduce((a, e) => a + Math.round(grossMinutes(e.start, e.end) * s.standbyFactor), 0);
  if (!iv.length) return { worked: standby, breakDeducted: 0, gaps: 0, night: 0 };
  const first = iv[0].a, last = Math.max(...iv.map((x) => x.b));
  const covered = unionLength(iv);
  const gaps = (last - first) - covered;
  const workCovered = unionLength(iv.filter((x) => x.kind !== 'reise'));
  const travelCovered = covered - workCovered;
  const entered = entries.filter((e) => WORK.has(e.kind)).reduce((a, e) => a + (e.breakMin ?? 0), 0);
  let required = 0;
  if (s.breakMode === 'firma') required = last - first >= s.companyBreakFromMin ? s.companyBreakMin : 0;
  else if (s.breakMode === 'gesetzlich') required = Math.max(entered + gaps, legalBreak(covered));
  else required = entered + gaps;
  const breakDeducted = Math.min(covered, Math.max(0, required - gaps));
  const travel = Math.round(travelCovered * s.travelFactor);
  const worked = Math.max(0, workCovered + travel - breakDeducted) + standby;
  // Nachtstunden (Standard 22–6 Uhr)
  const ns = timeToMinutes(s.nightStart), ne = timeToMinutes(s.nightEnd);
  const windows = ns > ne ? [[0, ne], [ns, 1440 + ne], [1440 + ns, 2880]] : [[ns, ne], [1440 + ns, 1440 + ne]];
  let night = 0;
  for (const x of iv) for (const [f, t] of windows) night += overlap(x.a, x.b, f, t);
  return { worked, breakDeducted, gaps, first, last, night };
}

export interface DaySummary {
  date: string;
  target: number;
  actual: number; // für das Gleitzeitkonto angerechnet (inkl. Urlaub/Krank-Gutschrift)
  worked: number; // tatsächlich gearbeitete Stunden („Std.“ im Zeitnachweis)
  diff: number;
  breakDeducted: number;
  first?: number;
  last?: number;
  sat: number; // Samstagsstunden (25 %)
  sun: number; // Sonntagsstunden (50 %)
  hol: number; // Feiertagsstunden (100 %)
  night: number;
  paidSeparately: number; // nicht im Gleitzeitkonto (Sonn-/Feiertag, Nacht), wird separat ausgewiesen
  nightPaid: number;
  absence?: string;
  holiday?: string;
  half?: string;
  warnings: string[];
}

const ABSENCE = new Set(['urlaub', 'krank']);

export function summarizeDay(date: string, entries: TimeEntry[], s: Settings, prevDayEntries: TimeEntry[] = []): DaySummary {
  const target = dailyTarget(date, s);
  const holiday = holidayName(date, s.state);
  const absenceEntry = entries.find((e) => ABSENCE.has(e.kind));
  const warnings: string[] = [];
  const w = dayWork(entries, s);
  const wd = weekday(date);
  const sat = wd === 6 && !holiday ? w.worked : 0;
  const sun = wd === 0 && !holiday ? w.worked : 0;
  const hol = holiday ? w.worked : 0;
  // Sonn-/Feiertag ganz separat; an anderen Tagen die Nachtstunden (wie Überstunden, Auszahlung mit Zuschlag)
  const sunHol = s.separateSunHoliday ? sun + hol : 0;
  const nightPaid = s.nightSeparate && !sunHol ? Math.min(w.night, w.worked) : 0;
  const paidSeparately = sunHol + nightPaid;
  let actual = w.worked - paidSeparately;
  // Urlaub/Krank: Soll gilt als erfüllt. Gleittag: kein Gutschrift → Überstunden werden abgebaut.
  if (absenceEntry) actual += target;
  // 24.12./31.12.: halber Tag frei (halber Urlaubstag) – die Hälfte des Solls gilt als erfüllt
  else if (target && halfDayName(date)) actual += Math.round(target / 2);

  const workNet = w.worked;
  if (s.arbzgWarnings && workNet > 10 * 60) warnings.push('Mehr als 10 h Arbeitszeit (§3 ArbZG)');
  if (s.breakMode === 'manuell') for (const e of entries) {
    if (WORK.has(e.kind) && (e.breakMin ?? 0) < legalBreak(grossMinutes(e.start, e.end)))
      warnings.push(`Pause unter gesetzlichem Minimum (${legalBreak(grossMinutes(e.start, e.end))} min)`);
  }
  const lastEnd = latestEnd(prevDayEntries);
  const firstStart = earliestStart(entries);
  if (lastEnd !== undefined && firstStart !== undefined) {
    const rest = 24 * 60 - lastEnd + firstStart;
    if (s.arbzgWarnings && rest < 11 * 60) warnings.push(`Ruhezeit nur ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} h (§5 ArbZG: 11 h)`);
  }
  if (s.arbzgWarnings && entries.length > 0 && (weekday(date) === 0 || holiday)) warnings.push(holiday ? `Arbeit am Feiertag (${holiday})` : 'Sonntagsarbeit');

  return {
    date, target, actual, worked: w.worked, diff: actual - target, breakDeducted: w.breakDeducted, first: w.first, last: w.last,
    sat: Math.max(0, sat - nightPaid), sun, hol, night: w.night, paidSeparately, nightPaid,
    absence: absenceEntry?.kind, holiday, half: target ? halfDayName(date) : undefined, warnings: [...new Set(warnings)],
  };
}

function workTimes(entries: TimeEntry[]) {
  return entries.filter((e) => (WORK.has(e.kind) || e.kind === 'reise') && e.start && e.end);
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

export interface RangeSummary { days: DaySummary[]; target: number; actual: number; worked: number; diff: number; sat: number; sun: number; hol: number; night: number; nightPaid: number; paidSeparately: number }

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
  const sum = (k: keyof DaySummary) => days.reduce((a, d) => a + (d[k] as number), 0);
  const target = sum('target'), actual = sum('actual');
  return { days, target, actual, worked: sum('worked'), diff: actual - target, sat: sum('sat'), sun: sum('sun'), hol: sum('hol'), night: sum('night'), nightPaid: sum('nightPaid'), paidSeparately: sum('paidSeparately') };
}

export interface GlzAccount {
  balance: number; // GLZ-Saldo Gesamt
  previous: number; // GLZ-Saldo Vorperiode (Stand am Ende des Vormonats)
  periodSaldo: number; // Saldo der aktuellen Periode (Monat von `until`)
  overCap: number; // in der aktuellen Periode über der Obergrenze → separat (z. B. „Gleitzeitstunden 125 %“)
  overCapTotal: number;
}

/**
 * Gleitzeitkonto bis einschließlich `until`, monatsweise wie im SAP-Zeitnachweis:
 * Saldo des Monats wird addiert; liegt das Konto am Monatsende über der Obergrenze,
 * wird es auf die Obergrenze gesetzt und der Rest separat ausgewiesen.
 */
export function glzAccount(until: string, all: TimeEntry[], s: Settings): GlzAccount {
  let balance = s.overtimeStartBalance, previous = balance, periodSaldo = 0, overCap = 0, overCapTotal = 0;
  if (until < s.overtimeStartDate) return { balance, previous, periodSaldo, overCap, overCapTotal };
  let from = s.overtimeStartDate;
  while (from <= until) {
    const monthEnd = addDays(addDays(from.slice(0, 8) + '01', 32).slice(0, 8) + '01', -1);
    const to = monthEnd < until ? monthEnd : until;
    previous = balance;
    periodSaldo = summarizeRange(from, to, all, s).diff;
    let next = balance + periodSaldo;
    overCap = 0;
    if (s.glzCapMin > 0 && next > s.glzCapMin) { overCap = next - s.glzCapMin; next = s.glzCapMin; }
    overCapTotal += overCap;
    balance = next;
    from = addDays(monthEnd, 1);
  }
  return { balance, previous, periodSaldo, overCap, overCapTotal };
}

/** Gleitzeit-/Überstundenkonto bis einschließlich `until` */
export function overtimeBalance(until: string, all: TimeEntry[], s: Settings): number {
  return glzAccount(until, all, s).balance;
}

export interface WeekSum { kw: number; from: string; to: string; worked: number; target: number; diff: number }
/** Wochensummen innerhalb eines Zeitraums (Wochen am Monatsrand werden abgeschnitten, wie im Zeitnachweis) */
export function weeklySums(range: RangeSummary, counts: (d: string) => boolean = () => true): WeekSum[] {
  const out: WeekSum[] = [];
  for (const d of range.days) {
    const w = isoWeekOf(d.date);
    let cur = out[out.length - 1];
    if (!cur || cur.kw !== w) { cur = { kw: w, from: d.date, to: d.date, worked: 0, target: 0, diff: 0 }; out.push(cur); }
    cur.to = d.date; cur.worked += d.worked; cur.target += d.target; if (counts(d.date)) cur.diff += d.diff;
  }
  return out;
}
function isoWeekOf(iso: string): number {
  const [y, m, dd] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/** Stunden anzeigen: dezimal wie im Zeitnachweis (7,50) oder als Std:Min (7:30) */
export function fmtHours(min: number, s: Pick<Settings, 'hourFormat'>, signed = false): string {
  if (s.hourFormat === 'hm') return formatMinutes(min, signed);
  const v = Math.abs(min) / 60;
  const t = v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (min < 0 ? '−' : signed && min > 0 ? '+' : '') + t;
}

/**
 * Urlaub aus dem Kalender als Zeiteinträge einbeziehen (ein Eintrag pro Tag),
 * damit er auch in der Zeiterfassung das Soll erfüllt. Doppelte Tage werden nicht doppelt gezählt.
 */
export function withCalendarVacation(times: TimeEntry[], events: CalendarEvent[]): TimeEntry[] {
  const have = new Set(times.filter((t) => t.kind === 'urlaub').map((t) => t.date));
  const extra: TimeEntry[] = [];
  for (const ev of events) {
    if (ev.type !== 'urlaub') continue;
    for (const d of eachDay(ev.startDate, ev.endDate)) {
      if (have.has(d)) continue;
      have.add(d);
      extra.push({ id: `cal-${ev.id}-${d}`, date: d, kind: 'urlaub', note: ev.title });
    }
  }
  return extra.length ? [...times, ...extra] : times;
}

export interface VacationSummary {
  entitlement: number; // Jahresanspruch + Übertrag
  annual: number;
  carryOver: number;
  halfDays: { date: string; name: string }[];
  halfTotal: number;
  taken: number;
  planned: number;
  remaining: number; // frei verplanbar (Rest − verplant)
  rest: number; // Rest wie im Zeitnachweis: Anspruch − Verbrauch
  days: { date: string; value: number }[];
}

/** Urlaubskonto eines Jahres: Anspruch − ½ Tage (24./31.12.) − genommen − geplant */
export function vacationSummary(year: number, times: TimeEntry[], events: CalendarEvent[], s: Settings, today: string): VacationSummary {
  const y = String(year);
  const all = withCalendarVacation(times, events);
  const halfDays = [`${y}-12-24`, `${y}-12-31`].filter((d) => isWorkday(d, s)).map((d) => ({ date: d, name: halfDayName(d)! }));
  const halfSet = new Set(halfDays.map((h) => h.date));
  const dates = [...new Set(all.filter((e) => e.kind === 'urlaub' && e.date.startsWith(y) && isWorkday(e.date, s)).map((e) => e.date))].sort();
  // an 24./31.12. ist der halbe Tag schon über halfDays abgezogen; Urlaub kostet dort die andere Hälfte
  const days = dates.map((d) => ({ date: d, value: halfSet.has(d) ? 0.5 : 1 }));
  const halfTotal = halfDays.length * 0.5;
  const halfPast = halfDays.filter((h) => h.date <= today).length * 0.5;
  const taken = days.filter((d) => d.date <= today).reduce((a, d) => a + d.value, 0) + halfPast;
  const planned = days.filter((d) => d.date > today).reduce((a, d) => a + d.value, 0) + (halfTotal - halfPast);
  const carryOver = s.vacationCarryOver?.[y] ?? 0;
  const entitlement = s.vacationDaysPerYear + carryOver;
  const rest = entitlement - taken;
  return { entitlement, annual: s.vacationDaysPerYear, carryOver, halfDays, halfTotal, taken, planned, days, rest, remaining: rest - planned };
}

export function vacationUsed(year: number, all: TimeEntry[], s: Settings): number {
  const v = vacationSummary(year, all, [], s, '9999-12-31');
  return v.taken;
}

/** Stichtag für Salden: heute nur, wenn schon etwas eingetragen ist – sonst bis gestern (der Tag läuft noch). */
export function balanceDate(today: string, all: TimeEntry[]): string {
  return all.some((e) => e.date === today) ? today : addDays(today, -1);
}

/** Überstundenstand so setzen, dass er zu Beginn von `date` genau `minutes` beträgt */
export function setBalanceAt(date: string, minutes: number): Pick<Settings, 'overtimeStartDate' | 'overtimeStartBalance'> {
  return { overtimeStartDate: date, overtimeStartBalance: Math.round(minutes) };
}
