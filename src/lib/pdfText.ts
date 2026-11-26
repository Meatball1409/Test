/** Text einer PDF als Zeilen (pdf.js, läuft komplett im Browser, wird erst bei Bedarf geladen) */
export async function pdfLines(file: Blob): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Textstücke nach Zeile (y) gruppieren, innerhalb der Zeile nach x sortieren
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, s: it.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
  }
  return lines;
}
