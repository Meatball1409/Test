/**
 * Minimaler PDF-Schreiber für gescannte Belege: jede Seite = ein JPEG, eingepasst in A4 hoch.
 * JPEG wird unverändert eingebettet (DCTDecode) – klein und überall lesbar.
 */

export interface PdfPage { jpeg: Uint8Array; w: number; h: number }

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 18;

export function dataUrlToBytes(d: string): Uint8Array {
  const b64 = d.slice(d.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Größe eines JPEG aus dem SOF-Segment lesen */
export function jpegSize(b: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  throw new Error('Kein gültiges JPEG');
}

export function makePdf(pages: PdfPage[], title = 'Beleg'): Uint8Array {
  if (!pages.length) throw new Error('Keine Seiten');
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (x: string | Uint8Array) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n: number, body: () => void) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1 Katalog, 2 Seitenbaum, 3 Info, danach je Seite: Seite, Bild, Inhalt
  const first = 4;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  const safe = title.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
  obj(3, () => push(`<< /Title (${safe}) /Producer (TechDesk) >>`));
  pages.forEach((p, i) => {
    const n = first + i * 3;
    const s = Math.min((A4.w - 2 * MARGIN) / p.w, (A4.h - 2 * MARGIN) / p.h);
    const dw = +(p.w * s).toFixed(2), dh = +(p.h * s).toFixed(2);
    const x = +((A4.w - dw) / 2).toFixed(2), y = +(A4.h - MARGIN - dh).toFixed(2); // oben ausgerichtet
    const content = `q ${dw} 0 0 ${dh} ${x} ${y} cm /Im0 Do Q`;
    obj(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`));
    obj(n + 1, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
    obj(n + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });
  const count = first + pages.length * 3;
  const xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Belegseiten (JPEG-Data-URLs) → PDF */
export function receiptPdf(pageUrls: string[], title: string): Uint8Array {
  return makePdf(pageUrls.map((u) => { const jpeg = dataUrlToBytes(u); return { jpeg, ...jpegSize(jpeg) }; }), title);
}
