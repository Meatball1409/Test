import { addDays, daysBetween } from './dates';
import type { Settings, Trip } from './types';

export interface MealAllowance {
  days: { date: string; label: string; amount: number }[];
  gross: number;
  deductions: number;
  net: number;
}

/**
 * Verpflegungsmehraufwand nach deutscher Systematik (§9 Abs. 4a EStG):
 * eintägig > 8 h → Teilpauschale; mehrtägig: An-/Abreisetag Teilpauschale, Zwischentage volle Pauschale.
 * Kürzung für gestellte Mahlzeiten: Frühstück 20 %, Mittag-/Abendessen je 40 % der vollen Pauschale.
 */
export function mealAllowance(trip: Trip, s: Settings): MealAllowance {
  const full = trip.mealFullOverride ?? s.mealFull;
  const partial = trip.mealPartialOverride ?? s.mealPartial;
  const days: MealAllowance['days'] = [];
  if (!trip.departure || !trip.return || trip.return <= trip.departure) return { days, gross: 0, deductions: 0, net: 0 };
  const d0 = trip.departure.slice(0, 10), d1 = trip.return.slice(0, 10);
  const n = daysBetween(d0, d1);
  if (n === 0) {
    const hours = (new Date(trip.return).getTime() - new Date(trip.departure).getTime()) / 3_600_000;
    days.push({ date: d0, label: hours > 8 ? 'Eintägig > 8 h' : 'Eintägig ≤ 8 h (keine Pauschale)', amount: hours > 8 ? partial : 0 });
  } else {
    for (let i = 0; i <= n; i++) {
      const iso = addDays(d0, i);
      const edge = i === 0 || i === n;
      days.push({ date: iso, label: i === 0 ? 'Anreisetag' : i === n ? 'Abreisetag' : 'Ganzer Tag (24 h)', amount: edge ? partial : full });
    }
  }
  const gross = days.reduce((a, d) => a + d.amount, 0);
  const deductions = Math.min(gross, round2(trip.breakfasts * full * 0.2 + (trip.lunches + trip.dinners) * full * 0.4));
  return { days, gross, deductions, net: round2(gross - deductions) };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function tripCosts(trip: Trip, s: Settings) {
  const meals = mealAllowance(trip, s);
  const mileage = ['auto'].includes(trip.transport) ? round2(trip.km * s.kmRate) : 0;
  const expenses = round2(trip.expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  return { meals, mileage, expenses, total: round2(meals.net + mileage + expenses) };
}

export const DEFAULT_CHECKLIST = [
  'Reisepass / Personalausweis (Gültigkeit prüfen)',
  'Visum / A1-Bescheinigung (EU-Entsendung)',
  'Laptop + Netzteil + Service-Software / Lizenzdongle',
  'Diagnosekabel, USB-Stick, Netzwerkkabel',
  'Werkzeugkoffer / Messgeräte (Kalibrierung prüfen)',
  'PSA: Sicherheitsschuhe, Gehörschutz, Brille, Handschuhe',
  'Ersatzteile / Lieferschein',
  'Auftrag, Maschinennummer, Ansprechpartner vor Ort',
  'Hotel- und Mietwagen-Bestätigung',
  'Firmenkreditkarte / Bargeld Landeswährung',
  'Reiseadapter / Powerbank',
  'Kunden-Sicherheitsunterweisung / Zugangsdaten',
];

export const EXPENSE_CATEGORIES = ['Hotel', 'Flug', 'Bahn', 'Mietwagen', 'Tanken', 'Parken', 'Maut', 'Taxi / ÖPNV', 'Bewirtung', 'Sonstiges'];
