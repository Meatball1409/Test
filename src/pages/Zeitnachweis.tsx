import { formatDateDE, MONTHS, weekdayShort } from '../lib/dates';
import { fmtHours, type DaySummary, type GlzAccount, type RangeSummary, type VacationSummary, type WeekSum } from '../lib/time';
import { TIME_KINDS, type Settings, type TimeEntry, type Trip } from '../lib/types';
import { isDomestic } from '../lib/visa';
import { printHtml } from './ReportDoc';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hm = (m?: number) => (m === undefined ? '' : `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/** Monatsnachweis im Aufbau des SAP-Zeitnachweises (zum Abgleichen) als PDF drucken */
export function printZeitnachweis(p: {
  s: Settings; month: string; to: string; sum: RangeSummary; byDate: (d: string) => TimeEntry[]; glz: GlzAccount; counted: RangeSummary;
  weeks: WeekSum[]; vac: VacationSummary; monthDiff: number; counts: (d: string) => boolean; running: Map<string, number>; tripOn: (d: string) => Trip | undefined;
}) {
  const { s } = p;
  const H = (m: number, signed = false) => fmtHours(m, { hourFormat: 'dezimal' }, signed);
  const logo = document.querySelector<HTMLImageElement>('.nav .logo-img')?.currentSrc;
  const rows: string[] = [];
  let weekKw = -1;
  const weekRow = (w: WeekSum) => `<tr class="wk"><td colspan="5">Wochensumme: ${formatDateDE(w.from)} – ${formatDateDE(w.to)}</td><td class="r">${H(w.worked)}</td><td class="r">${H(w.target)}</td><td class="r">${H(w.diff, true)}</td><td></td></tr>`;
  const dayRow = (d: DaySummary) => {
    const es = p.byDate(d.date);
    const trip = p.tripOn(d.date);
    const label = d.holiday ?? d.half ?? (d.absence ? TIME_KINDS[d.absence as keyof typeof TIME_KINDS] : trip ? (isDomestic(trip.country) ? 'Dienstreise' : 'Auslandsdienstreise') : es.length ? '' : d.target ? '' : '');
    const out = [`<tr class="day"><td>${d.date.slice(8)}</td><td>${weekdayShort(d.date).toUpperCase()}</td><td>${esc(label)}</td><td>${hm(d.first)}</td><td>${hm(d.last)}</td><td class="r">${d.worked ? H(d.worked) : ''}</td><td class="r">${H(d.target)}</td><td class="r">${p.counts(d.date) && (d.diff || d.actual) ? H(d.diff, true) : ''}</td><td class="r">${p.counts(d.date) ? H(p.running.get(d.date) ?? 0) : ''}</td></tr>`];
    for (const e of es.filter((x) => x.start)) out.push(`<tr class="seg"><td></td><td></td><td>${TIME_KINDS[e.kind]}${e.customer ? ' · ' + esc(e.customer) : ''}</td><td>${e.start ?? ''}</td><td>${e.end ?? ''}</td><td></td><td></td><td></td><td></td></tr>`);
    if (d.breakDeducted) out.push(`<tr class="seg"><td></td><td></td><td>Pause (automatisch)</td><td></td><td></td><td class="r">−${H(d.breakDeducted)}</td><td></td><td></td><td></td></tr>`);
    if (d.nightPaid) out.push(`<tr class="seg"><td></td><td></td><td>Nachtstunden ${s.nightPct} % (Auszahlung)</td><td></td><td></td><td class="r">${H(d.nightPaid)}</td><td></td><td></td><td></td></tr>`);
    if (d.sat) out.push(`<tr class="seg"><td></td><td></td><td>Überstunden Samstag 25 %</td><td></td><td></td><td class="r">${H(d.sat)}</td><td></td><td></td><td></td></tr>`);
    if (d.sun) out.push(`<tr class="seg"><td></td><td></td><td>Sonntag 50 %</td><td></td><td></td><td class="r">${H(d.sun)}</td><td></td><td></td><td></td></tr>`);
    if (d.hol) out.push(`<tr class="seg"><td></td><td></td><td>Feiertag 100 %</td><td></td><td></td><td class="r">${H(d.hol)}</td><td></td><td></td><td></td></tr>`);
    return out.join('');
  };
  for (const d of p.sum.days) {
    const w = p.weeks.find((x) => d.date >= x.from && d.date <= x.to)!;
    if (weekKw !== -1 && w.kw !== weekKw) rows.push(weekRow(p.weeks.find((x) => x.kw === weekKw)!));
    weekKw = w.kw;
    rows.push(dayRow(d));
  }
  if (weekKw !== -1) rows.push(weekRow(p.weeks.find((x) => x.kw === weekKw)!));
  rows.push(`<tr class="sum"><td colspan="5">Monats-Summe</td><td class="r">${H(p.sum.worked)}</td><td class="r">${H(p.sum.target)}</td><td class="r">${H(p.monthDiff, true)}</td><td></td></tr>`);

  const ov = (a: [string, string][]) => a.map(([k, v]) => `<tr><td>${k}</td><td class="r">${v}</td></tr>`).join('');
  const html = `<style>${CSS}</style><div class="zn">
  <header><div><h1>Zeitnachweis</h1><p>vom ${formatDateDE(p.month)} bis ${formatDateDE(p.to)}</p><p class="muted">${esc(s.name || '')}${s.name ? ' · ' : ''}eigene Erfassung (TechDesk) zum Abgleich</p></div>${logo ? `<img src="${logo}" alt="Logo">` : ''}</header>
  <table class="t"><thead><tr><th>Tag</th><th></th><th>Art</th><th>von</th><th>bis</th><th class="r">Std.</th><th class="r">Soll</th><th class="r">Saldo</th><th class="r">Summe</th></tr></thead><tbody>${rows.join('')}</tbody></table>
  <div class="two">
    <section><h2>Monatsübersicht zum Stichtag</h2><table class="t">${ov([
      ['GLZ-Saldo Vorperiode', H(p.glz.previous)], ['GLZ-Saldo akt. Periode', H(p.glz.periodSaldo - p.glz.overCap, true)], ['GLZ-Saldo Gesamt', H(p.glz.balance)],
      ['Rahmen Gleitzeitkonto', s.glzCapMin ? `${H(s.glzFloorMin, true)} bis +${H(s.glzCapMin)}` : '–'], [`Gleitzeitstunden ${100 + s.overPayPct} % (Auszahlung)`, H(p.glz.overCap)], ['Überstunden 25 % (Samstag)', H(p.counted.sat)],
      ['Sonntag 50 %', H(p.counted.sun)], ['Feiertag 100 %', H(p.counted.hol)], [`Nachtstunden ${s.nightStart}–${s.nightEnd}${s.nightSeparate ? ` (${100 + s.nightPct} %)` : ''}`, H(s.nightSeparate ? p.counted.nightPaid : p.counted.night)],
    ])}</table></section>
    <section><h2>Wochensummen</h2><table class="t"><thead><tr><th>KW</th><th>Beginn</th><th>Ende</th><th class="r">Ist</th><th class="r">Soll</th><th class="r">Saldo</th></tr></thead><tbody>${p.weeks.map((w) => `<tr><td>${w.kw}</td><td>${formatDateDE(w.from)}</td><td>${formatDateDE(w.to)}</td><td class="r">${H(w.worked)}</td><td class="r">${H(w.target)}</td><td class="r">${H(w.diff, true)}</td></tr>`).join('')}</tbody></table>
    <h2>Urlaub ${p.month.slice(0, 4)}</h2><table class="t"><thead><tr><th>Anspruch</th><th class="r">Rest</th><th class="r">Verplant</th><th class="r">Verbrauch</th></tr></thead><tbody><tr><td>${p.vac.entitlement.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td><td class="r">${p.vac.rest.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td><td class="r">${p.vac.planned.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td><td class="r">${p.vac.taken.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</td></tr></tbody></table></section>
  </div>
  <p class="muted foot">Erstellt mit TechDesk am ${new Date().toLocaleDateString('de-DE')}. Eigene Aufzeichnung – maßgeblich ist der offizielle Zeitnachweis.</p>
  </div>`;
  printHtml(html, `Zeitnachweis_${MONTHS[Number(p.month.slice(5, 7)) - 1]}_${p.month.slice(0, 4)}`);
}

const CSS = `
.zn { font: 9pt/1.35 Arial, sans-serif; color: #111; padding: 12mm 12mm; background: #fff; }
.zn header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6mm; }
.zn header img { height: 14mm; }
.zn h1 { font-size: 16pt; margin: 0 0 2mm; }
.zn h2 { font-size: 10.5pt; margin: 5mm 0 2mm; }
.zn p { margin: 0; }
.zn .muted { color: #666; font-size: 8pt; }
.zn table.t { width: 100%; border-collapse: collapse; }
.zn .t th, .zn .t td { border: .2mm solid #333; padding: .7mm 1.4mm; text-align: left; }
.zn .t th { background: #e9e9e9; font-weight: 700; }
.zn .r { text-align: right !important; font-variant-numeric: tabular-nums; }
.zn tr.day td { font-weight: 600; }
.zn tr.seg td { font-weight: 400; color: #333; }
.zn tr.wk td, .zn tr.sum td { background: #f0f0f0; font-weight: 700; }
.zn tr { break-inside: avoid; }
.zn .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; break-inside: avoid; }
.zn .foot { margin-top: 6mm; }
@media screen { .zn { max-width: 210mm; } }`;
