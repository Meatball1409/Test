import type { StateCode } from './holidays';

export type EventType = 'einsatz' | 'reise' | 'remote' | 'schulung' | 'buero' | 'bereitschaft' | 'urlaub' | 'privat';
export const EVENT_TYPES: Record<EventType, { label: string; color: string }> = {
  einsatz: { label: 'Kundeneinsatz', color: '#3B82C4' },
  reise: { label: 'Reise', color: '#8B5CF6' },
  remote: { label: 'Remote-Support', color: '#0EA5A4' },
  schulung: { label: 'Schulung', color: '#F59E0B' },
  buero: { label: 'Büro / Werk', color: '#64748B' },
  bereitschaft: { label: 'Bereitschaft', color: '#EF4444' },
  urlaub: { label: 'Urlaub', color: '#22C55E' },
  privat: { label: 'Privat', color: '#A3A3A3' },
};

export interface CalendarEvent {
  id: string;
  title: string;
  type: EventType;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  customer?: string;
  location?: string;
  machine?: string;
  notes?: string;
  tripId?: string;
}

export type TimeKind = 'arbeit' | 'kunde' | 'reise' | 'bereitschaft' | 'urlaub' | 'krank' | 'gleittag';
export const TIME_KINDS: Record<TimeKind, string> = {
  arbeit: 'Arbeitszeit',
  kunde: 'Kundenbesuch',
  reise: 'Reisezeit',
  bereitschaft: 'Bereitschaft',
  urlaub: 'Urlaub',
  krank: 'Krank',
  gleittag: 'Überstundenabbau / Gleittag',
};

export interface TimeEntry {
  id: string;
  date: string;
  kind: TimeKind;
  start?: string;
  end?: string;
  breakMin?: number;
  customer?: string;
  note?: string;
}

export interface Settings {
  id: 'main';
  name: string;
  state: StateCode;
  weeklyHours: number;
  workDays: number[]; // 1=Mo … 5=Fr, 6=Sa, 0=So
  travelFactor: number; // Anteil der Reisezeit, der als Arbeitszeit zählt (0–1)
  standbyFactor: number; // Anteil Bereitschaft als Arbeitszeit
  /** firma: feste Pause ab Schwelle (z. B. 45 min ab 8 h) · gesetzlich: Mindestpause ArbZG §4 · manuell: wie eingetragen */
  breakMode: 'firma' | 'gesetzlich' | 'manuell';
  companyBreakMin: number;
  companyBreakFromMin: number; // ab dieser Anwesenheit (Minuten) wird die Firmenpause abgezogen
  companyBreakStart: string; // nur zur Anzeige, z. B. 12:00
  arbzgWarnings: boolean;
  hourFormat: 'dezimal' | 'hm'; // 7,50 wie im SAP-Zeitnachweis oder 7:30
  glzCapMin: number; // Obergrenze Gleitzeitkonto in Minuten (0 = keine); darüber: Auszahlung mit Zuschlag
  glzFloorMin: number; // Untergrenze (negativ, z. B. −150 Std.); darunter: Warnung
  overPayPct: number; // Zuschlag auf Stunden über der Obergrenze (25 %)
  separateSunHoliday: boolean; // Sonn-/Feiertagsstunden nicht ins Gleitzeitkonto, sondern separat (Auszahlung)
  nightStart: string;
  nightEnd: string;
  overtimeStartBalance: number; // Minuten Übertrag
  overtimeStartDate: string;
  vacationDaysPerYear: number;
  vacationCarryOver: Record<string, number>; // Jahr → übertragene Resttage aus dem Vorjahr
  kmRate: number;
  mealFull: number;
  mealPartial: number;
  companyName: string;
  logoDataUrl?: string;
  homeAddress: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  name: '',
  state: 'BY',
  weeklyHours: 40,
  workDays: [1, 2, 3, 4, 5],
  travelFactor: 1,
  standbyFactor: 0,
  breakMode: 'firma',
  companyBreakMin: 45,
  companyBreakFromMin: 8 * 60,
  companyBreakStart: '12:00',
  arbzgWarnings: true,
  hourFormat: 'dezimal',
  glzCapMin: 150 * 60,
  glzFloorMin: -150 * 60,
  overPayPct: 25,
  separateSunHoliday: true,
  nightStart: '22:00',
  nightEnd: '06:00',
  overtimeStartBalance: 0,
  overtimeStartDate: `${new Date().getFullYear()}-01-01`,
  vacationDaysPerYear: 30,
  vacationCarryOver: {},
  kmRate: 0.3,
  mealFull: 28,
  mealPartial: 14,
  companyName: 'MULTIVAC',
  homeAddress: '',
};

export interface Snippet {
  id: string;
  title: string;
  category: string;
  lang: 'de' | 'en';
  body: string;
  favorite?: boolean;
}

export interface NumberedItem { title: string; text: string; photos?: string[] }
export interface ReportSummary { problem: string; cause: string; result: string }

export interface ServiceReport {
  id: string;
  createdAt: string;
  updatedAt: string;
  topic: string;
  servicePeriod: string;
  customer: string;
  site: string;
  equipment: string;
  machineNumbers: string;
  technicians: string;
  assignmentType: string;
  initialSituation: string;
  findings: NumberedItem[];
  recommendations: NumberedItem[];
  conclusion: string;
  openItems: string[];
  arrival?: string; // ISO-Datum Anreise
  departure?: string; // ISO-Datum Abreise
  summary?: ReportSummary;
}

export interface Expense { id: string; date: string; category: string; amount: number; note?: string }
export interface ChecklistItem { id: string; text: string; done: boolean }

export interface Trip {
  id: string;
  title: string;
  customer: string;
  destination: string;
  country: string;
  departure: string; // 'YYYY-MM-DDTHH:MM'
  return: string;
  transport: 'auto' | 'firmenwagen' | 'flug' | 'bahn';
  hotel?: string;
  bookingRefs?: string;
  contactOnSite?: string;
  km: number;
  breakfasts: number;
  lunches: number;
  dinners: number;
  mealFullOverride?: number; // Auslandspauschale
  mealPartialOverride?: number;
  checklist: ChecklistItem[];
  expenses: Expense[];
  notes?: string;
}
