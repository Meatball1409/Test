/**
 * Belegscanner – reine Bildverarbeitung auf dem Gerät (kein Server, keine Bibliothek).
 * 1. Kanten des Belegs finden (heller Beleg vor dunklerem Hintergrund)
 * 2. Perspektive entzerren (vier Ecken → Rechteck)
 * 3. Scan-Filter: Dokument (Hintergrund weiß, Schrift kräftig), Graustufen oder Farbe
 */

export interface Pt { x: number; y: number }
export type Quad = [Pt, Pt, Pt, Pt]; // oben links, oben rechts, unten rechts, unten links
export type ScanFilter = 'dokument' | 'grau' | 'farbe';

/** Schwellwert nach Otsu für Helligkeitswerte 0–255 */
export function otsu(lum: ArrayLike<number>): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[lum[i] | 0]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Ecken des Belegs aus einem (verkleinerten) Helligkeitsbild schätzen.
 * Helle Pixel = Papier. Extremwerte von x+y und x−y liefern die vier Ecken – funktioniert auch schräg.
 * Gibt Koordinaten relativ (0–1) zurück; null, wenn kein klarer Beleg erkennbar ist.
 */
export function detectQuad(lum: ArrayLike<number>, w: number, h: number): Quad | null {
  let lo = 255, hi = 0;
  for (let i = 0; i < lum.length; i++) { if (lum[i] < lo) lo = lum[i]; if (lum[i] > hi) hi = lum[i]; }
  if (hi - lo < 40) return null; // kein Kontrast zwischen Beleg und Unterlage
  const thr = otsu(lum);
  let n = 0;
  let tl = { v: Infinity, x: 0, y: 0 }, br = { v: -Infinity, x: 0, y: 0 }, tr = { v: -Infinity, x: 0, y: 0 }, bl = { v: Infinity, x: 0, y: 0 };
  // Rand ignorieren (Vignette, Tischkante)
  const m = Math.round(Math.min(w, h) * 0.01);
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
    if (lum[y * w + x] <= thr) continue;
    n++;
    const s = x + y, d = x - y;
    if (s < tl.v) tl = { v: s, x, y };
    if (s > br.v) br = { v: s, x, y };
    if (d > tr.v) tr = { v: d, x, y };
    if (d < bl.v) bl = { v: d, x, y };
  }
  const share = n / ((w - 2 * m) * (h - 2 * m));
  if (share < 0.08 || share > 0.97) return null;
  const r = (p: { x: number; y: number }): Pt => ({ x: p.x / (w - 1), y: p.y / (h - 1) });
  const q: Quad = [r(tl), r(tr), r(br), r(bl)];
  if (quadArea(q) < 0.05) return null;
  // minimal nach innen, damit kein Schattenrand der Unterlage im Scan bleibt
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: p.x + (cx - p.x) * 0.012, y: p.y + (cy - p.y) * 0.012 })) as Quad;
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
}
export const DEFAULT_QUAD: Quad = [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Zielgröße aus den Kantenlängen (Pixel), lange Seite begrenzt */
export function targetSize(q: Quad, maxLong = 1800): { w: number; h: number } {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, maxLong / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  return { w, h };
}

/** Homographie, die das Rechteck (0,0)-(w,h) auf das Viereck q (in Pixeln) abbildet: [a..h] mit i=1 */
export function homography(w: number, h: number, q: Quad): number[] {
  const src: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
export function mapPoint(H: number[], x: number, y: number): Pt {
  const z = H[6] * x + H[7] * y + 1;
  return { x: (H[0] * x + H[1] * y + H[2]) / z, y: (H[3] * x + H[4] * y + H[5]) / z };
}

/** Viereck aus dem Quellbild ausschneiden und entzerren (RGBA-Puffer, bilinear) */
export function warp(src: { data: Uint8ClampedArray; width: number; height: number }, qPx: Quad, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const H = homography(w, h, qPx);
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = src.width, sh = src.height, d = src.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = H[6] * (x + 0.5) + H[7] * (y + 0.5) + 1;
      let u = (H[0] * (x + 0.5) + H[1] * (y + 0.5) + H[2]) / z - 0.5;
      let v = (H[3] * (x + 0.5) + H[4] * (y + 0.5) + H[5]) / z - 0.5;
      u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

const lumOf = (d: ArrayLike<number>, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Perzentil der Helligkeit (für Kontrastdehnung) */
function percentile(d: Uint8ClampedArray, p: number): number {
  const hist = new Array(256).fill(0);
  const step = Math.max(1, Math.floor(d.length / 4 / 200_000)) * 4;
  let n = 0;
  for (let i = 0; i < d.length; i += step) { hist[lumOf(d, i) | 0]++; n++; }
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * p) return i; }
  return 255;
}

/** Scan-Filter direkt im Puffer anwenden */
export function applyFilter(d: Uint8ClampedArray, mode: ScanFilter): void {
  const lo = percentile(d, 0.02), hi = Math.max(lo + 1, percentile(d, mode === 'dokument' ? 0.6 : 0.98));
  const k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    if (mode === 'farbe') {
      for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] - lo) * k;
      continue;
    }
    let l = (lumOf(d, i) - lo) * k;
    if (mode === 'dokument') l = l >= 235 ? 255 : Math.pow(Math.max(0, l) / 255, 1.6) * 255; // Papier weiß, Schrift kräftiger
    d[i] = d[i + 1] = d[i + 2] = l;
  }
}

/* ---------- Browser-Teil ---------- */

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 30_000); }
}

/** Bild auf Arbeitsgröße bringen (max. 2400 px), optional gedreht (Vielfache von 90°) */
export function toCanvas(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, rotate = 0, max = 2400): HTMLCanvasElement {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, max / Math.max(iw, ih));
  const w = Math.round(iw * s), h = Math.round(ih * s);
  const turn = ((rotate % 360) + 360) % 360;
  const c = document.createElement('canvas');
  c.width = turn % 180 ? h : w; c.height = turn % 180 ? w : h;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/** Ecken im Bild automatisch finden (auf ~240 px verkleinert) */
export function autoQuad(c: HTMLCanvasElement): Quad {
  const s = Math.min(1, 240 / Math.max(c.width, c.height));
  const w = Math.max(2, Math.round(c.width * s)), h = Math.max(2, Math.round(c.height * s));
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const ctx = t.getContext('2d')!;
  ctx.drawImage(c, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const lum = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = lumOf(d, i * 4);
  return detectQuad(lum, w, h) ?? DEFAULT_QUAD;
}

/** Fertige Seite als JPEG erzeugen */
export function renderPage(c: HTMLCanvasElement, q: Quad, mode: ScanFilter): { dataUrl: string; w: number; h: number } {
  const qPx = q.map((p) => ({ x: p.x * c.width, y: p.y * c.height })) as Quad;
  const { w, h } = targetSize(qPx);
  const src = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  const px = warp(src, qPx, w, h);
  applyFilter(px, mode);
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  o.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return { dataUrl: o.toDataURL('image/jpeg', mode === 'farbe' ? 0.8 : 0.72), w, h };
}
