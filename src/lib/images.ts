/**
 * Fotos für Berichte: auf max. 1600 px verkleinern und als JPEG (≈150–400 KB) speichern.
 * So bleiben Berichte klein genug für das Gerät, den Abgleich und den PDF-Export.
 */
export async function compressImage(file: Blob, maxDim = 1600, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden (Format?)'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h); // Browser berücksichtigen die EXIF-Ausrichtung beim Zeichnen
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mehrere Fotos auswählen (Kamera oder Mediathek) */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    i.multiple = true;
    i.onchange = () => resolve([...(i.files ?? [])]);
    i.click();
  });
}
