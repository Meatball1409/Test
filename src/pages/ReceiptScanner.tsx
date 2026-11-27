import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Modal, useToast } from '../components';
import { receiptPdf } from '../lib/pdf';
import { autoQuad, DEFAULT_QUAD, loadImage, renderPage, toCanvas, type Quad, type ScanFilter } from '../lib/scan';

function pickPhoto(camera: boolean): Promise<File | undefined> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    if (camera) i.setAttribute('capture', 'environment');
    i.onchange = () => resolve(i.files?.[0]);
    i.click();
  });
}

export function openPdf(pages: string[], title: string) {
  const blob = new Blob([receiptPdf(pages, title) as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = `${title.replace(/\W+/g, '_')}.pdf`; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface Shot { img: HTMLImageElement; rotate: number; canvas: HTMLCanvasElement; preview: string; quad: Quad }

const FILTERS: [ScanFilter, string][] = [['dokument', 'Dokument'], ['grau', 'Graustufen'], ['farbe', 'Farbe']];

/** Belegscanner: fotografieren, Ecken anpassen, Filter, mehrere Seiten → eine PDF */
export function ReceiptScanner({ pages: initial, title, onSave, onClose }: { pages: string[]; title: string; onSave: (pages: string[]) => void; onClose: () => void }) {
  const toast = useToast();
  const [pages, setPages] = useState(initial);
  const [shot, setShot] = useState<Shot | null>(null);
  const [filter, setFilter] = useState<ScanFilter>('dokument');
  const [busy, setBusy] = useState(false);

  async function take(camera: boolean) {
    const f = await pickPhoto(camera);
    if (!f) return;
    setBusy(true);
    try { setShot(prepare(await loadImage(f), 0)); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }
  function prepare(img: HTMLImageElement, rotate: number): Shot {
    const canvas = toCanvas(img, rotate);
    const p = toCanvas(canvas, 0, 900);
    return { img, rotate, canvas, preview: p.toDataURL('image/jpeg', 0.7), quad: autoQuad(canvas) };
  }
  function accept() {
    if (!shot) return;
    setBusy(true);
    // kurz rendern lassen, damit „wird verarbeitet“ sichtbar ist
    setTimeout(() => {
      try { setPages((p) => [...p, renderPage(shot.canvas, shot.quad, filter).dataUrl]); setShot(null); } catch (e) { toast((e as Error).message); }
      setBusy(false);
    }, 30);
  }

  if (shot) return (
    <Modal title={`Seite ${pages.length + 1} zuschneiden`} onClose={() => setShot(null)} footer={<>
      <button className="btn" onClick={() => setShot(null)}>Verwerfen</button>
      <span className="spacer" />
      <button className="btn primary" disabled={busy} onClick={accept}>{busy ? 'Wird verarbeitet …' : 'Seite übernehmen'}</button>
    </>}>
      <p className="muted small">Ecken auf die Belegkanten ziehen. Das Bild wird gerade gerückt und wie ein Scan aufbereitet.</p>
      <CropView shot={shot} onQuad={(quad) => setShot({ ...shot, quad })} />
      <div className="scan-tools">
        <div className="seg" role="group" aria-label="Filter">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={() => setShot(prepare(shot.img, shot.rotate + 90))}>↻ Drehen</button>
          <button className="btn small" onClick={() => setShot({ ...shot, quad: autoQuad(shot.canvas) })}>Kanten erkennen</button>
          <button className="btn small" onClick={() => setShot({ ...shot, quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })}>Ganzes Bild</button>
        </div>
      </div>
    </Modal>
  );

  return (
    <Modal title="Beleg scannen" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <span className="spacer" />
      <button className="btn primary" onClick={() => { onSave(pages); onClose(); }}>{pages.length ? `Als PDF speichern (${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'})` : 'Speichern'}</button>
    </>}>
      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={() => take(true)}>📷 Foto aufnehmen</button>
        <button className="btn" disabled={busy} onClick={() => take(false)}>Aus Galerie</button>
        {pages.length > 0 && <button className="btn ghost" onClick={() => openPdf(pages, title)}>PDF ansehen</button>}
      </div>
      {busy && <p className="muted small">Bild wird geladen …</p>}
      {pages.length === 0 ? <p className="muted">Noch keine Seite. Beleg auf eine dunkle Unterlage legen und fotografieren – die Kanten werden automatisch erkannt.</p> : (
        <div className="scan-pages">
          {pages.map((p, i) => (
            <figure key={i}>
              <img src={p} alt={`Seite ${i + 1}`} />
              <figcaption>Seite {i + 1}
                {i > 0 && <button className="icon" aria-label="Nach vorn" onClick={() => setPages((x) => { const y = [...x]; [y[i - 1], y[i]] = [y[i], y[i - 1]]; return y; })}>←</button>}
                <button className="icon" aria-label="Seite entfernen" onClick={() => setPages((x) => x.filter((_, j) => j !== i))}>✕</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Modal>
  );
}

function CropView({ shot, onQuad }: { shot: Shot; onQuad: (q: Quad) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const q = shot.quad ?? DEFAULT_QUAD;
  const ratio = shot.canvas.width / shot.canvas.height;
  function move(e: RPointerEvent) {
    if (drag === null || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const n = [...q] as Quad; n[drag] = { x, y };
    onQuad(n);
  }
  const pts = q.map((p) => `${p.x * 1000},${p.y * 1000 / ratio}`).join(' ');
  return (
    <div className="crop" ref={box} style={{ aspectRatio: String(ratio) }} onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      <img src={shot.preview} alt="Aufnahme" draggable={false} />
      <svg viewBox={`0 0 1000 ${1000 / ratio}`} preserveAspectRatio="none">
        <polygon points={pts} />
      </svg>
      {q.map((p, i) => (
        <span key={i} className={`handle${drag === i ? ' on' : ''}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          onPointerDown={(e) => { e.preventDefault(); box.current?.setPointerCapture?.(e.pointerId); setDrag(i); }} />
      ))}
    </div>
  );
}
