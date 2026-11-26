/**
 * Liest den SAP-Zeitnachweis (Fiori, „Zeitnachweis vom … bis …“) aus Textzeilen.
 * Reine Funktion ohne PDF-Bibliothek – die Zeilen kommen aus der PDF (pdf.js) oder aus eingefügtem Text.
 * Persönliche Daten (Personalnummer, Kostenstelle …) werden nicht ausgewertet.
 */
import type { TimeEntry, TimeKind } from './types';

export interface SapSegment { kind: TimeKind; label: string; start: string; end: string }
export interface SapDay {
  date: string;
  label: string; // z. B. „Auslandsdienstreise a. RK“, „Urlaub“
  absence?: 'urlaub' | 'krank' | 'gleittag';
  segments: SapSegment[];
  std?: number; // „Std.“ laut SAP (Minuten)
  soll?: number;
  saldo?: number;
}
export interface SapStatement {
  from?: string;
  to?: string;
  stichtag?: string;
  days: SapDay[];
  glzTotal?: number; // GLZ-Saldo Gesamt (Minuten)
  glzPrevious?: number;
  overCapPaid?: number; // Gleitzeitstunden 125 %
  vacation?: { entitlement: number; rest: number; planned: number; used: number; until?: string };
  unknown: string[]; // nicht erkannte Zeilen mit Uhrzeiten (zur Kontrolle)
}

const WD = /^(MO|DI|MI|DO|FR|SA|SO)$/i;
const TIME = /^\d{1,2}:\d{2}$/;
const NUM = /^-?\d{1,3}(?:\.\d{3})*,\d{2}-?$|^-?\d+,\d{2}-?$/;

/** „1.234,50-“ → Minuten (−1234,5 h) */
export function sapNum(s: string): number {
  const neg = s.endsWith('-') || s.startsWith('-');
  const v = Number(s.replace(/[-.]/g, '').replace(',', '.'));
  return Math.round((neg ? -v : v) * 60);
}
const deDate = (s: string) => { const [d, m, y] = s.split('.'); return `${y}-${m}-${d}`; };
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: string) => { const [h, m] = t.split(':'); return `${pad(Number(h))}:${m}`; };

function segmentKind(label: string): TimeKind | null {
  const l = label.toLowerCase();
  if (/dienstreise|urlaub|krank|arbeitsunf|feiertag|frei\b|abwesen|gleittag|zeitausgleich/.test(l)) return null; // Tagesart, kein Abschnitt
  if (/reise/.test(l)) return 'reise';
  if (/kunde/.test(l)) return 'kunde';
  if (/bereitschaft|rufbereit/.test(l)) return 'bereitschaft';
  return 'arbeit'; // Arbeitszeit, Anwesenheit, Kommen/Gehen, Remote …
}
function absenceOf(label: string): SapDay['absence'] {
  const l = label.toLowerCase();
  if (/urlaub/.test(l)) return 'urlaub';
  if (/krank|arbeitsunf/.test(l)) return 'krank';
  if (/gleittag|zeitausgleich|glz-?tag|freizeitausgleich/.test(l)) return 'gleittag';
  return undefined;
}

export function parseSapStatement(lines: string[]): SapStatement {
  const out: SapStatement = { days: [], unknown: [] };
  const clean = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = clean.join('\n');

  const period = all.match(/vom\s+(\d{2}\.\d{2}\.\d{4})\s+bis\s+(\d{2}\.\d{2}\.\d{4})/i);
  if (period) { out.from = deDate(period[1]); out.to = deDate(period[2]); }
  const stich = all.match(/Stichtag\s+(\d{2}\.\d{2}\.\d{4})/i);
  if (stich) out.stichtag = deDate(stich[1]);
  const val = (re: RegExp) => { const m = all.match(re); return m ? sapNum(m[1]) : undefined; };
  out.glzTotal = val(/GLZ-Saldo\s+Gesamt\s+(-?[\d.]*\d,\d{2}-?)/i);
  out.glzPrevious = val(/GLZ-Saldo\s+Vorperiode\s+(-?[\d.]*\d,\d{2}-?)/i);
  out.overCapPaid = val(/Gleitzeitstunden\s+125\s?%\s+(-?[\d.]*\d,\d{2}-?)/i);
  const vac = all.match(/(?:Tarif)?[Uu]rlaub\s+(\d{2}\.\d{2}\.\d{4})\s+(\d+,\d{2})\s+(-?\d+,\d{2}-?)\s+(\d+,\d{2})\s+(\d+,\d{2})/);
  if (vac) {
    const n = (s: string) => Number(s.replace(/-$/, '').replace(',', '.')) * (s.endsWith('-') ? -1 : 1);
    out.vacation = { until: deDate(vac[1]), entitlement: n(vac[2]), rest: n(vac[3]), planned: n(vac[4]), used: n(vac[5]) };
  }

  // Tageszeilen: „26 MO Reisezeit 07:30 08:00 7,50 8,00 0,50- 153,50 0,00 MES9“ und Folgezeilen „Kundenbesuch 08:00 12:00“
  const start = out.from ?? '';
  let year = Number(start.slice(0, 4)) || new Date().getFullYear();
  let month = Number(start.slice(5, 7)) || 1;
  let prevDay = 0;
  let cur: SapDay | null = null;
  for (const line of clean) {
    if (/^(Wochensumme|Monats-?Summe|Tag\s+von\s+bis|Zeitkonto|KW\s+Beginn)/i.test(line)) { if (/^Wochensumme|^Monats/i.test(line)) cur = null; continue; }
    const tok = line.split(' ');
    let i = 0;
    let isHeader = false;
    if (/^\d{1,2}$/.test(tok[0]) && tok[1] && WD.test(tok[1])) {
      const day = Number(tok[0]);
      if (day < prevDay) { month++; if (month > 12) { month = 1; year++; } }
      prevDay = day;
      cur = { date: `${year}-${pad(month)}-${pad(day)}`, label: '', segments: [] };
      out.days.push(cur);
      i = 2; isHeader = true;
    }
    if (!cur) continue;
    // Label bis zur ersten Uhrzeit oder Zahl
    const labelTok: string[] = [];
    while (i < tok.length && !TIME.test(tok[i]) && !NUM.test(tok[i])) labelTok.push(tok[i++]);
    const label = labelTok.join(' ');
    const times: string[] = [];
    while (i < tok.length && TIME.test(tok[i]) && times.length < 2) times.push(tok[i++]);
    const nums: number[] = [];
    while (i < tok.length && NUM.test(tok[i])) nums.push(sapNum(tok[i++]));

    if (isHeader) {
      cur.label = label;
      cur.absence = absenceOf(label);
      if (nums.length >= 3) { cur.std = nums[0]; cur.soll = nums[1]; cur.saldo = nums[2]; }
      else if (nums.length === 2) { cur.std = nums[0]; cur.soll = nums[1]; }
    }
    if (times.length === 2 && label) {
      const kind = segmentKind(label);
      if (kind) cur.segments.push({ kind, label, start: hhmm(times[0]), end: hhmm(times[1]) });
      else if (!isHeader) out.unknown.push(line);
    } else if (!isHeader && times.length === 0 && label && nums.length === 0 && !cur.segments.length && !cur.label) {
      cur.label = label;
    }
  }
  return out;
}

/** Zeiteinträge für die App aus dem Nachweis (stabile IDs → erneuter Import ersetzt statt verdoppelt) */
export function sapToEntries(st: SapStatement): TimeEntry[] {
  const out: TimeEntry[] = [];
  for (const d of st.days) {
    if (d.absence && !d.segments.length) { out.push({ id: `sap-${d.date}-a`, date: d.date, kind: d.absence, note: `SAP: ${d.label}` }); continue; }
    d.segments.forEach((sg, k) => out.push({ id: `sap-${d.date}-${k}`, date: d.date, kind: sg.kind, start: sg.start, end: sg.end, breakMin: 0, note: `SAP: ${sg.label}` }));
  }
  return out;
}
