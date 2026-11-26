/** Datum-Hilfen. Alle Daten als ISO-String 'YYYY-MM-DD' (lokale Zeit), Uhrzeiten als 'HH:MM'. */

export const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseISODate(fromIso).getTime();
  const b = parseISODate(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function eachDay(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** 0 = Sonntag … 6 = Samstag */
export function weekday(iso: string): number {
  return parseISODate(iso).getDay();
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(min: number, signed = false): string {
  const sign = min < 0 ? '−' : signed && min > 0 ? '+' : '';
  const abs = Math.abs(Math.round(min));
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
}

export function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function weekdayShort(iso: string): string {
  return WD[weekday(iso)];
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** ISO-8601 Kalenderwoche */
export function isoWeek(iso: string): number {
  const d = parseISODate(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso: string): string {
  const d = parseISODate(startOfMonth(iso));
  d.setMonth(d.getMonth() + 1, 0);
  return toISODate(d);
}

export function uid(): string {
  return crypto.randomUUID();
}
