import { describe, expect, it } from 'vitest';
import { applyFilter, detectQuad, homography, mapPoint, otsu, targetSize, warp, type Quad } from './scan';
import { bytesToBase64, jpegSize, makePdf, receiptPdf } from './pdf';
import { fakeJpeg } from './testUtils';

/** Synthetisches Foto: heller, schräg liegender Beleg auf dunklem Tisch */
function photo(w: number, h: number, q: Quad) {
  const lum = new Uint8Array(w * h);
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false; }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = inside(x, y) ? 225 + ((x * 7 + y * 3) % 20) : 40 + ((x + y) % 25);
  return lum;
}
describe('Belegscanner', () => {
  it('Otsu trennt Papier und Hintergrund', () => {
    const t = otsu([30, 35, 40, 45, 220, 225, 230, 240]);
    expect(t).toBeGreaterThanOrEqual(45);
    expect(t).toBeLessThan(220);
  });

  it('erkennt die Ecken eines schräg liegenden Belegs', () => {
    const q: Quad = [{ x: 60, y: 30 }, { x: 170, y: 50 }, { x: 150, y: 220 }, { x: 40, y: 200 }];
    const r = detectQuad(photo(220, 260, q), 220, 260)!;
    expect(r).not.toBeNull();
    r.forEach((p, i) => {
      expect(Math.abs(p.x * 219 - q[i].x)).toBeLessThan(4);
      expect(Math.abs(p.y * 259 - q[i].y)).toBeLessThan(4);
    });
  });

  it('kein Beleg erkennbar → null (Standard-Rahmen wird genutzt)', () => {
    expect(detectQuad(new Uint8Array(100 * 100).fill(128), 100, 100)).toBeNull();
  });

  it('Entzerrung: Rechteck-Ecken landen auf den Beleg-Ecken', () => {
    const q: Quad = [{ x: 10, y: 20 }, { x: 300, y: 5 }, { x: 320, y: 400 }, { x: 0, y: 380 }];
    const { w, h } = targetSize(q);
    const H = homography(w, h, q);
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y], i) => {
      const p = mapPoint(H, x, y);
      expect(p.x).toBeCloseTo(q[i].x, 6);
      expect(p.y).toBeCloseTo(q[i].y, 6);
    });
  });

  it('Ausschnitt und Dokument-Filter: Papier wird weiß, Schrift bleibt dunkel', () => {
    const W = 40, H = 40, d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; const v = x >= 10 && x < 30 && y >= 10 && y < 30 ? (y === 20 ? 60 : 200) : 30; d.set([v, v, v, 255], i * 4); }
    const out = warp({ data: d, width: W, height: H }, [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }], 20, 20);
    applyFilter(out, 'dokument');
    expect(out[(5 * 20 + 5) * 4]).toBe(255); // Papier
    expect(out[(10 * 20 + 5) * 4]).toBeLessThan(80); // Schriftzeile
  });
});

describe('PDF aus Belegseiten', () => {
  it('liest die JPEG-Größe', () => expect(jpegSize(fakeJpeg(1240, 1754))).toEqual({ w: 1240, h: 1754 }));

  it('mehrseitige PDF mit gültiger Querverweistabelle', () => {
    const pdf = makePdf([{ jpeg: fakeJpeg(800, 1200), w: 800, h: 1200 }, { jpeg: fakeJpeg(1200, 800), w: 1200, h: 800 }], 'Beleg Hotel');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2);
    // jeder xref-Eintrag zeigt auf "n 0 obj"
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const entries = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(9);
    entries.forEach((off, i) => expect(text.slice(off, off + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });

  it('aus Data-URLs (wie in der App gespeichert)', () => {
    const url = 'data:image/jpeg;base64,' + bytesToBase64(fakeJpeg(600, 900));
    expect(new TextDecoder('latin1').decode(receiptPdf([url, url, url], 'x'))).toContain('/Count 3');
  });
});
