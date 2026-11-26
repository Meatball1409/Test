/** Platzhalter im Format {{Name}} oder {{Name|Standardwert}} */
const RX = /\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g;

export function placeholders(body: string): { name: string; def: string }[] {
  const seen = new Map<string, string>();
  for (const m of body.matchAll(RX)) if (!seen.has(m[1])) seen.set(m[1], m[2] ?? '');
  return [...seen].map(([name, def]) => ({ name, def }));
}

export function fillTemplate(body: string, values: Record<string, string>, missing = '[___]'): string {
  return body.replace(RX, (_, name: string, def?: string) => {
    const v = values[name.trim()];
    return v && v.trim() ? v : def && def.trim() ? def : missing;
  });
}

/** Für das FSM: Markdown/Sonderzeichen entfernen, Zeilenumbrüche normalisieren */
export function toPlainText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
