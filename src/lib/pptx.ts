import type { Branding } from './report';
import type { NumberedItem, ServiceReport } from './types';

type Slide = ReturnType<InstanceType<typeof import('pptxgenjs').default>['addSlide']>;
const NAVY = '1E2B50', ACCENT = '3B82C4', BG = 'F5F6F9', CARD = 'FFFFFF', TEXT = '4A5064', MUTED = '5F6370', LINE = 'E1E4EC';
const val = (s?: string) => (s && s.trim() ? s.trim() : '[___]');
const filled = (a: NumberedItem[]) => a.filter((i) => i.title.trim() || i.text.trim() || (i.photos?.length ?? 0) > 0);

/** Erstellt eine Präsentation (16:9) aus einem Servicebericht und lädt sie herunter. */
export async function downloadPptx(r: ServiceReport, b: Branding) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  p.title = `Service Visit ${r.customer}`;
  const W = 13.33;
  const brand = (s: Slide, x: number, y: number, w: number, h: number, size: number) =>
    b.logoDataUrl ? s.addImage({ data: b.logoDataUrl, x, y, w, h, sizing: { type: 'contain', w, h } })
      : s.addText(b.companyName || 'SERVICE', { x, y, w: w * 1.5, h, fontFace: 'Arial', bold: true, color: NAVY, fontSize: size, charSpacing: 4, margin: 0 });

  let slideNo = 1;
  const content = (eyebrow: string, title: string) => {
    const s = p.addSlide();
    s.background = { color: BG };
    s.addText(eyebrow.toUpperCase(), { x: 0.6, y: 0.4, w: 9, h: 0.3, fontFace: 'Arial', fontSize: 11, bold: true, color: ACCENT, charSpacing: 3, margin: 0 });
    s.addText(title, { x: 0.6, y: 0.72, w: 12, h: 0.6, fontFace: 'Arial', fontSize: 28, bold: true, color: NAVY, margin: 0 });
    s.addShape('line', { x: 0.6, y: 6.85, w: W - 1.2, h: 0, line: { color: LINE, width: 0.75 } });
    brand(s, 0.6, 6.98, 1.32, 0.25, 10);
    s.addText(`${val(r.customer)} · ${++slideNo}`, { x: W - 4.6, y: 6.98, w: 4, h: 0.25, fontFace: 'Arial', fontSize: 10, color: MUTED, align: 'right', margin: 0 });
    return s;
  };
  const cards = (s: Slide, items: { n?: string; title: string; text: string; photo?: string }[]) => {
    const gap = 0.3, w = (W - 1.2 - gap * 2) / 3;
    items.forEach((it, i) => {
      const x = 0.6 + i * (w + gap), y = 1.65;
      s.addShape('rect', { x, y, w, h: 4.9, fill: { color: CARD }, line: { color: LINE, width: 0.5 } });
      s.addShape('rect', { x, y, w, h: 0.08, fill: { color: NAVY }, line: { color: NAVY, width: 0 } });
      let ty = y + 0.3;
      if (it.n) { s.addText(it.n, { x: x + 0.3, y: ty, w: 1.2, h: 0.6, fontFace: 'Arial', fontSize: 30, bold: true, color: ACCENT, margin: 0 }); ty += 0.75; }
      s.addText(it.title, { x: x + 0.3, y: ty, w: w - 0.6, h: 0.7, fontFace: 'Arial', fontSize: 17, bold: true, color: NAVY, valign: 'top', margin: 0, fit: 'shrink' });
      const photoH = it.photo ? 2.0 : 0;
      s.addText(it.text, { x: x + 0.3, y: ty + 0.8, w: w - 0.6, h: 4.9 - (ty - y) - 1.05 - (photoH ? photoH + 0.15 : 0), fontFace: 'Arial', fontSize: 14, color: TEXT, valign: 'top', margin: 0, fit: 'shrink' });
      if (it.photo) s.addImage({ data: it.photo, x: x + 0.3, y: y + 4.9 - 0.25 - photoH, w: w - 0.6, h: photoH, sizing: { type: 'cover', w: w - 0.6, h: photoH } });
    });
  };

  const f = filled(r.findings), rec = filled(r.recommendations);

  // 1 Cover
  const c = p.addSlide();
  c.background = { color: BG };
  brand(c, 0.6, 0.5, 3.0, 0.57, 20);
  c.addText('SERVICE VISIT', { x: 0.6, y: 2.2, w: 7, h: 0.35, fontFace: 'Arial', fontSize: 13, bold: true, color: ACCENT, charSpacing: 4, margin: 0 });
  c.addText(r.topic.trim() || 'Meeting Summary', { x: 0.6, y: 2.6, w: 7.4, h: 1.4, fontFace: 'Arial', fontSize: 40, bold: true, color: NAVY, valign: 'top', margin: 0, fit: 'shrink' });
  c.addText(`${val(r.customer)} · ${val(r.site)}`, { x: 0.6, y: 4.1, w: 7.4, h: 0.4, fontFace: 'Arial', fontSize: 18, color: MUTED, margin: 0 });
  c.addText(`${val(r.equipment)} · ${val(r.machineNumbers)}\n${val(r.servicePeriod)} · ${val(r.technicians)}`, { x: 0.6, y: 5.8, w: 7.4, h: 0.8, fontFace: 'Arial', fontSize: 13, color: MUTED, margin: 0 });
  const rx = W * 0.63;
  c.addShape('rect', { x: rx, y: 0, w: W - rx, h: 7.5, fill: { color: NAVY }, line: { color: NAVY, width: 0 } });
  c.addShape('rect', { x: rx, y: 0, w: 0.09, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 } });
  c.addText(String(f.length + rec.length), { x: rx + 0.6, y: 2.2, w: 4, h: 1.6, fontFace: 'Arial', fontSize: 96, bold: true, color: 'FFFFFF', margin: 0 });
  c.addText('points across findings and recommendations', { x: rx + 0.6, y: 3.9, w: 4, h: 0.8, fontFace: 'Arial', fontSize: 16, color: 'DCE3F0', margin: 0 });

  // 2 Übersicht
  const ov = content('Overview', 'Work carried out');
  const rows = [...f.map((x) => ({ t: x.title, l: 'Finding' })), ...rec.map((x) => ({ t: x.title, l: 'Recommendation' }))];
  const perCol = 7, colW = (W - 1.2 - 0.3) / 2;
  rows.slice(0, perCol * 2).forEach((row, i) => {
    const col = Math.floor(i / perCol), x = 0.6 + col * (colW + 0.3), y = 1.6 + (i % perCol) * 0.76;
    ov.addShape('rect', { x, y, w: colW, h: 0.66, fill: { color: CARD }, line: { color: LINE, width: 0.5 } });
    ov.addShape('rect', { x, y, w: 0.07, h: 0.66, fill: { color: NAVY }, line: { color: NAVY, width: 0 } });
    ov.addText(String(i + 1).padStart(2, '0'), { x: x + 0.2, y, w: 0.6, h: 0.66, fontFace: 'Arial', fontSize: 16, bold: true, color: ACCENT, valign: 'middle', margin: 0 });
    ov.addText(val(row.t), { x: x + 0.85, y, w: colW - 2.9, h: 0.66, fontFace: 'Arial', fontSize: 14, bold: true, color: NAVY, valign: 'middle', margin: 0, fit: 'shrink' });
    ov.addText(row.l, { x: x + colW - 2.0, y, w: 1.85, h: 0.66, fontFace: 'Arial', fontSize: 11, color: MUTED, align: 'right', valign: 'middle', margin: 0 });
  });

  // 3 Ausgangslage
  cards(content('Background', 'Initial situation'), [
    { title: 'Initial situation and objective', text: val(r.initialSituation) },
    { title: 'Equipment', text: `${val(r.equipment)}\nMachine number(s): ${val(r.machineNumbers)}` },
    { title: 'Type of assignment', text: `${val(r.assignmentType)}\nService period: ${val(r.servicePeriod)}` },
  ]);

  // 4 Findings
  for (let i = 0; i < f.length; i += 3)
    cards(content('Findings', 'Findings and work carried out'), f.slice(i, i + 3).map((x, j) => ({ n: String(i + j + 1).padStart(2, '0'), title: val(x.title), text: x.text.trim() ? x.text.trim() : '', photo: x.photos?.[0] })));

  // 5 Recommendations + Conclusion
  const recCards = rec.map((x, j) => ({ n: String(f.length + j + 1).padStart(2, '0'), title: val(x.title), text: val(x.text) }));
  const open = r.openItems.filter((o) => o.trim());
  recCards.push({ n: '', title: 'Conclusion', text: val(r.conclusion) + (open.length ? '\n\nNext steps:\n' + open.map((o) => '– ' + o).join('\n') : '') });
  for (let i = 0; i < recCards.length; i += 3)
    cards(content(i + 3 >= recCards.length ? 'Recommendations & conclusion' : 'Recommendations', 'Recommendations'), recCards.slice(i, i + 3).map((x) => ({ ...x, n: x.n || undefined })));

  const dt = new Date().toLocaleDateString('de-DE').replace(/\//g, '.');
  await p.writeFile({ fileName: `Service_Visit_${(r.customer || 'Customer').replace(/[^\p{L}\p{N}]+/gu, '_')}_${dt}.pptx` });
}
