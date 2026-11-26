import { useEffect, useMemo, useRef, useState } from 'react';
import { useLogoUrl } from '../brand';
import { useSettings } from '../db';
import { reportPages, scopedReportCss } from '../lib/report';
import type { ServiceReport } from '../lib/types';

const PAGE_PX = 793.7; // 210 mm bei 96 dpi
const SCOPE = '.rp';
let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  const st = document.createElement('style');
  st.textContent = scopedReportCss(SCOPE) + `
${SCOPE} .page { box-shadow: 0 2px 14px rgba(0,0,0,.18); margin: 0 auto 18px; }
@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #fff !important; }
  body > *:not(#print-root) { display: none !important; }
  #print-root { display: block !important; }
  #print-root ${SCOPE} .page { box-shadow: none; margin: 0; }
}
#print-root { display: none; }`;
  document.head.appendChild(st);
}

/** Dokument-Vorschau (A4-Seiten, verkleinert auf die verfügbare Breite) */
export function ReportPreview({ report, pages, maxWidth }: { report: ServiceReport; pages?: number; maxWidth?: number }) {
  injectCss();
  const s = useSettings();
  const logo = useLogoUrl();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const html = useMemo(() => {
    const all = reportPages(report, { companyName: s.companyName, logoDataUrl: logo });
    if (!pages) return all;
    return all.split('<section class="page"').slice(0, pages + 1).join('<section class="page"');
  }, [report, s.companyName, logo, pages]);
  const count = (html.match(/<section class="page"/g) ?? []).length;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, (maxWidth ?? el.clientWidth) / PAGE_PX)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);
  return (
    <div ref={box} className="doc-preview" style={{ height: count * (1122.5 + 18) * scale }}>
      <div className="rp" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAGE_PX }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** Druckt den Bericht in diesem Fenster (im Druckdialog „Als PDF sichern“ wählen) */
export function printReport(html: string, title: string) {
  printHtml(`<div class="rp">${html}</div>`, title);
}

/** Beliebiges HTML drucken (Druckdialog → „Als PDF sichern“) */
export function printHtml(inner: string, title: string) {
  injectCss();
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = inner;
  const oldTitle = document.title;
  document.title = title; // wird von vielen Browsern als Dateiname vorgeschlagen
  const imgs = [...root.querySelectorAll('img')];
  void Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
    window.print();
    setTimeout(() => { document.title = oldTitle; }, 1000);
  });
}
