import { toPlainText } from './templates';
import type { NumberedItem, ServiceReport } from './types';

export const M = '[___]';
const v = (s?: string) => (s && s.trim() ? s.trim() : M);
const pad2 = (n: number) => String(n).padStart(2, '0');

export function emptyReport(id: string, technician = ''): ServiceReport {
  const now = new Date().toISOString();
  return {
    id, createdAt: now, updatedAt: now, topic: '', servicePeriod: '', customer: '', site: '', equipment: '',
    machineNumbers: '', technicians: technician, assignmentType: '', initialSituation: '',
    findings: [{ title: '', text: '' }], recommendations: [], conclusion: '', openItems: [],
  };
}

const filled = (items: NumberedItem[]) => items.filter((i) => i.title.trim() || i.text.trim());

/** Felder, die im Bericht noch fehlen (werden im FSM-Text als [___] markiert) */
export function missingFields(r: ServiceReport): string[] {
  const out: string[] = [];
  const req: [keyof ServiceReport, string][] = [
    ['servicePeriod', 'Service period'], ['customer', 'Customer'], ['site', 'Site'], ['equipment', 'Equipment'],
    ['machineNumbers', 'Machine number(s)'], ['technicians', 'Service technician(s)'], ['assignmentType', 'Type of assignment'],
    ['initialSituation', 'Initial situation and objective'], ['conclusion', 'Conclusion'],
  ];
  for (const [k, label] of req) if (!String(r[k] ?? '').trim()) out.push(label);
  if (filled(r.findings).length === 0) out.push('Findings');
  filled(r.findings).forEach((f, i) => { if (!f.title.trim() || !f.text.trim()) out.push(`Finding ${i + 1} (title/text)`); });
  filled(r.recommendations).forEach((f, i) => { if (!f.title.trim() || !f.text.trim()) out.push(`Recommendation ${i + 1} (title/text)`); });
  return out;
}

/** Plain text für SAP FSM: keine Tabellen, keine Markdown-Zeichen, Überschriften in GROSSBUCHSTABEN */
export function fsmText(r: ServiceReport): string {
  const L: string[] = [];
  L.push('SERVICE REPORT' + (r.topic.trim() ? ' - ' + r.topic.trim().toUpperCase() : ''), '');
  L.push('1. GENERAL INFORMATION');
  L.push(`Service period: ${v(r.servicePeriod)}`);
  L.push(`Customer / site: ${v(r.customer)} / ${v(r.site)}`);
  L.push(`Equipment: ${v(r.equipment)}`);
  L.push(`Machine number(s): ${v(r.machineNumbers)}`);
  L.push(`Service technician(s): ${v(r.technicians)}`);
  L.push(`Type of assignment: ${v(r.assignmentType)}`, '');
  L.push('2. INITIAL SITUATION AND OBJECTIVE', v(r.initialSituation), '');
  L.push('3. FINDINGS AND WORK CARRIED OUT');
  const f = filled(r.findings);
  if (f.length === 0) L.push(M);
  f.forEach((x, i) => L.push(`3.${i + 1} ${v(x.title)}`, v(x.text), ''));
  if (f.length) L.pop();
  L.push('');
  L.push('4. RECOMMENDATIONS');
  const rec = filled(r.recommendations);
  if (rec.length === 0) L.push('- None');
  rec.forEach((x, i) => L.push(`4.${i + 1} ${v(x.title).toUpperCase()}`, v(x.text), ''));
  if (rec.length) L.pop();
  L.push('');
  L.push('5. CONCLUSION AND OPEN ITEMS', v(r.conclusion));
  const open = r.openItems.filter((o) => o.trim());
  L.push('', 'Open items:');
  if (open.length === 0) L.push('- None');
  open.forEach((o) => L.push(`- ${o.trim()}`));
  return toPlainText(L.join('\n'));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const paras = (s: string) => esc(v(s)).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

export interface Branding { companyName: string; logoDataUrl?: string }

/** Kunden-Version als druckfertiges HTML (A4). Über „Drucken → Als PDF speichern“ wird daraus die PDF. */
export function customerHtml(r: ServiceReport, b: Branding, summary?: { problem: string; cause: string; result: string }): string {
  const logo = (h: string, size: string) => b.logoDataUrl
    ? `<img src="${b.logoDataUrl}" alt="${esc(b.companyName)}" style="height:${h};width:auto;display:block">`
    : `<span class="logo" style="font-size:${size}">${esc(b.companyName || 'SERVICE')}</span>`;
  const dateLabel = v(r.servicePeriod);
  let page = 1;
  const footer = () => `<div class="footer">${logo('4.6mm', '8.5pt')}<span>${esc(v(r.customer))} · Service Report ${esc(dateLabel)}</span><span>${++page}</span></div>`;
  const shell = (inner: string) => `<section class="page"><div class="topstripe"></div><div class="content">${inner}</div>${footer()}</section>`;
  const sec = (n: string, t: string) => `<div class="section"><span class="n">${n}</span><h2>${t}</h2></div>`;

  const cover = `<section class="page"><div class="cover-left">${logo('12mm', '15pt')}
    <div class="kicker">Service Report</div><h1 class="cover-title">${esc(v(r.topic))}</h1>
    <div class="cover-sub">${esc(v(r.assignmentType))}</div><div class="cover-bar"></div>
    <div class="cover-foot">Confidential – prepared for ${esc(v(r.customer))}</div></div>
    <div class="cover-right"><div class="meta">
    ${[['Customer', r.customer], ['Site', r.site], ['Machine number', r.machineNumbers], ['Service date', r.servicePeriod], ['Service technician', r.technicians]]
      .map(([k, x]) => `<div><span>${k}</span><b>${esc(v(x))}</b></div>`).join('')}
    </div></div></section>`;

  const sum = summary && (summary.problem || summary.cause || summary.result)
    ? sec('01', 'Summary') + `<div class="grid3">${[['Problem', summary.problem], ['Cause', summary.cause], ['Result', summary.result]]
      .map(([k, x]) => `<div class="card"><h3>${k}</h3>${paras(x)}</div>`).join('')}</div>` : '';
  const n = (i: number) => String(i + (sum ? 1 : 0)).padStart(2, '0');
  const info = [['Service period', r.servicePeriod], ['Customer', r.customer], ['Site', r.site], ['Equipment', r.equipment],
    ['Machine number(s)', r.machineNumbers], ['Service technician(s)', r.technicians], ['Type of assignment', r.assignmentType]]
    .map(([k, x]) => `<tr><td>${k}</td><td>${esc(v(x))}</td></tr>`).join('');
  const page2 = shell(sum + sec(n(1), 'General information') + `<div class="card"><table class="info">${info}</table></div>`
    + sec(n(2), 'Initial situation and objective') + `<div class="card">${paras(r.initialSituation)}</div>`);

  const findings = chunk(filled(r.findings), 3).map((grp, gi) => shell(sec(n(3), 'Findings and work carried out' + (gi ? ' (cont.)' : ''))
    + grp.map((f, i) => `<div class="card finding" style="grid-template-columns:13mm 1fr"><span class="num">${pad2(gi * 3 + i + 1)}</span><div><h4>${esc(v(f.title))}</h4>${paras(f.text)}</div></div>`).join('')));

  const recs = filled(r.recommendations);
  const open = r.openItems.filter((o) => o.trim());
  const last = shell((recs.length ? sec(n(4), 'Recommendations') + recs.map((x, i) => `<div class="card rec"><span class="num">${pad2(i + 1)}</span><div><h4>${esc(v(x.title))}</h4>${paras(x.text)}</div></div>`).join('') : '')
    + sec(n(recs.length ? 5 : 4), 'Conclusion and open items')
    + `<div class="card"><p><b>${esc(v(r.conclusion))}</b></p>${open.length ? `<h3 style="margin-top:4mm">Open items</h3><ul class="open">${open.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
    <div class="sign"><div>Service technician</div><div>Customer representative</div></div></div>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service_Report_${esc(r.customer || 'Customer')}</title><style>${REPORT_CSS}</style></head><body>${cover}${page2}${findings.join('')}${last}</body></html>`;
}

export const REPORT_CSS = `@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --navy:#1E2B50; --bg:#F5F6F9; --card:#FDFDFE; --accent:#3B82C4; --sub:#2B6CB0; --text:#4A5064; --muted:#5F6370; --line:#E1E4EC; }
body { font-family:'Inter',Arial,sans-serif; color:var(--text); font-size:9.6pt; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.page { width:210mm; height:297mm; position:relative; overflow:hidden; background:var(--bg); page-break-after:always; }
.page:last-child { page-break-after:auto; }
.logo { font-weight:800; letter-spacing:.14em; color:var(--navy); font-size:15pt; }
.cover-left { position:absolute; left:0; top:0; width:118mm; height:100%; padding:22mm 14mm 20mm 20mm; display:flex; flex-direction:column; }
.cover-right { position:absolute; right:0; top:0; width:92mm; height:100%; background:linear-gradient(160deg,#2A3B6B 0%,#1E2B50 45%,#141D38 100%); }
.cover-right::before { content:''; position:absolute; left:0; top:0; width:3.2mm; height:100%; background:linear-gradient(180deg,#8EC1EA,#3B82C4); }
.cover-right .meta { position:absolute; left:14mm; right:12mm; bottom:22mm; color:#DCE3F0; }
.cover-right .meta div { margin-bottom:5mm; }
.cover-right .meta span { display:block; font-size:7pt; letter-spacing:.14em; text-transform:uppercase; color:#8EC1EA; margin-bottom:.8mm; }
.cover-right .meta b { font-weight:600; font-size:10.5pt; color:#fff; }
.kicker { margin-top:auto; font-size:8pt; font-weight:700; letter-spacing:.22em; color:var(--sub); text-transform:uppercase; }
.cover-title { font-size:30pt; line-height:1.08; font-weight:800; color:var(--navy); margin:5mm 0 6mm; }
.cover-sub { font-size:12pt; color:var(--muted); }
.cover-bar { width:22mm; height:1.6mm; background:var(--accent); margin:9mm 0 0; }
.cover-foot { margin-top:38mm; font-size:8pt; color:var(--muted); }
.content { padding:17mm 16mm 22mm; }
.topstripe { position:absolute; top:0; left:0; right:0; height:2.2mm; background:var(--navy); }
.section { display:flex; align-items:baseline; gap:3.5mm; margin:0 0 4.5mm; }
.section .n { font-size:22pt; font-weight:800; color:var(--accent); line-height:1; }
.section h2 { font-size:15pt; color:var(--navy); font-weight:700; }
.card { background:var(--card); border-radius:2.2mm; border-left:1.4mm solid var(--navy); box-shadow:0 .4mm 1.6mm rgba(30,43,80,.08); padding:5mm 6mm; margin-bottom:4.2mm; break-inside:avoid; }
.card h3 { font-size:8pt; text-transform:uppercase; letter-spacing:.12em; color:var(--sub); font-weight:700; margin-bottom:1.6mm; }
.card p + p { margin-top:1.6mm; }
.grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4.2mm; margin-bottom:7mm; }
.grid3 .card { margin:0; }
table.info { width:100%; border-collapse:collapse; }
table.info td { padding:2.2mm 0; border-bottom:.25mm solid var(--line); vertical-align:top; }
table.info tr:last-child td { border-bottom:none; }
table.info td:first-child { width:48mm; color:var(--muted); font-size:8.6pt; }
table.info td:last-child { color:var(--navy); font-weight:500; }
.finding { display:grid; grid-template-columns:13mm 1fr 58mm; gap:5mm; align-items:start; }
.finding .num, .rec .num { font-size:20pt; font-weight:800; color:var(--accent); line-height:1; }
.finding h4, .rec h4 { font-size:11pt; color:var(--navy); margin-bottom:1.4mm; }
.rec { display:grid; grid-template-columns:13mm 1fr; gap:5mm; }
ul.open { list-style:none; }
ul.open li { padding-left:5mm; position:relative; margin-top:1.2mm; }
ul.open li::before { content:''; position:absolute; left:0; top:2mm; width:1.6mm; height:1.6mm; background:var(--accent); border-radius:50%; }
.sign { display:grid; grid-template-columns:1fr 1fr; gap:10mm; }
.sign div { border-top:.3mm solid var(--navy); padding-top:1.6mm; font-size:8pt; color:var(--muted); margin-top:14mm; }
.footer { position:absolute; left:16mm; right:16mm; bottom:9mm; display:flex; justify-content:space-between; align-items:center; font-size:7.5pt; color:var(--muted); border-top:.25mm solid var(--line); padding-top:3mm; }
.footer .logo { font-size:8.5pt; }`;
