import { AA, AA_BASE, AA_GENERIC, AKA, DATA, EMBASSY, EU, ID_OK, INFO, RW, SP, TRW, VISAFREE, type VisaEntry } from './visa-data';

export * from './visa-data';

/** Länder ohne Vorab-Antrag (alles in INFO, das keinen Antrag hat) */
export const VF: VisaEntry[] = Object.keys(INFO)
  .filter((n) => !DATA.some((d) => d.c === n))
  .map((n) => ({ c: n, aka: AKA[n] || '', cat: 'vf', what: EU.includes(n) ? 'EU' : 'Visumfrei', fee: ID_OK.includes(n) ? 'Personalausweis reicht' : 'Reisepass', note: '' }));
export const ALL: VisaEntry[] = [...DATA, ...VF];

export const CAT_LABEL: Record<VisaEntry['cat'], string> = { eta: 'Reisegenehmigung', evisa: 'Visum', card: 'Einreiseformular', vf: 'Kein Vorab-Antrag' };

/** Alle bekannten Ländernamen, alphabetisch – für die Auswahl im Reiseplaner */
export const COUNTRIES: string[] = [...new Set(['Deutschland', ...ALL.map((d) => d.c), ...EMBASSY, ...RW, ...TRW])].sort((a, b) => a.localeCompare(b, 'de'));

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const base = (c: string) => c.split(' / ')[0];

export const aaUrl = (n: string) => (AA[base(n)] ? AA_BASE + AA[base(n)] : AA_GENERIC);

export type Tone = 'ok' | 'warn' | 'bad';
const DE_OK = new Set(['C', 'E', 'F']);

export function adapter(types: string): { tone: Tone; text: string } {
  const t = types.split(',');
  const other = t.filter((x) => !DE_OK.has(x));
  if (!other.length) return { tone: 'ok', text: 'Nicht nötig' };
  if (other.length < t.length) return { tone: 'warn', text: `Empfohlen (Typ ${other.join('/')})` };
  return { tone: 'bad', text: `Nötig (Typ ${other.join('/')})` };
}

export function safety(c: string): { tone: Tone; text: string } {
  const n = base(c);
  if (RW.includes(n)) return { tone: 'bad', text: 'Reisewarnung' };
  if (TRW.includes(n)) return { tone: 'warn', text: 'Teilreisewarnung' };
  return { tone: 'ok', text: 'Keine Warnung' };
}

export interface OnSite { plugs: string; voltage: string; lowVoltage: boolean; adapter: { tone: Tone; text: string }; safety: { tone: Tone; text: string }; note: string }
export function onSite(c: string): OnSite | undefined {
  const i = INFO[c];
  if (!i) return undefined;
  const v = String(i[1]);
  return { plugs: i[0].replace(/,/g, ' / '), voltage: v, lowVoltage: /^(100|110|115|120|127)/.test(v), adapter: adapter(i[0]), safety: safety(c), note: i[2] };
}

export interface Allowance { full: number; partial: number; cities: { name: string; full: number; partial: number }[]; hint?: string }
/** Verpflegungspauschalen Ausland 2026 (24 h / An- und Abreisetag) */
export function allowance(c: string): Allowance | undefined {
  const s = SP[c];
  if (!s) return undefined;
  return { full: s[0], partial: s[1], cities: (s[2] ?? []).map(([name, full, partial]) => ({ name, full, partial })), hint: s[3] };
}

/** Einträge zu einem Land (Antrag + Formular können getrennt sein) */
export function entriesFor(country: string): VisaEntry[] {
  const n = norm(country.trim());
  if (!n) return [];
  return ALL.filter((d) => norm(d.c) === n || norm(base(d.c)) === n || d.c.split(' / ').some((p) => norm(p) === n));
}

export function search(term: string, filter: string, favs: Set<string>): VisaEntry[] {
  const t = norm(term.trim());
  return ALL.filter((d) => {
    if (filter === 'free' && !d.free) return false;
    if (filter === 'fav' && !favs.has(keyOf(d))) return false;
    if (['eta', 'evisa', 'card', 'vf'].includes(filter) && d.cat !== filter) return false;
    if (!t) return true;
    const hay = norm(`${d.c} ${d.aka} ${d.what}`);
    return hay.split(/[\s/(),.-]+/).some((w) => w.startsWith(t)) || (t.includes(' ') && hay.includes(t));
  }).sort((a, b) => a.c.localeCompare(b.c, 'de') || a.cat.localeCompare(b.cat));
}
export const keyOf = (d: VisaEntry) => `${d.c}|${d.cat}`;

/** Hinweis, wenn ein gesuchtes Land keine eigene Karte hat */
export function fallbackHint(term: string): { kind: 'warning' | 'embassy' | 'visafree'; country: string } | undefined {
  const t = norm(term.trim());
  if (!t) return undefined;
  const hit = (arr: string[]) => arr.find((n) => norm(n).includes(t) || t.includes(norm(n)));
  const wa = hit([...RW, ...TRW]); if (wa) return { kind: 'warning', country: wa };
  const em = hit(EMBASSY); if (em) return { kind: 'embassy', country: em };
  const vf = hit(VISAFREE); if (vf) return { kind: 'visafree', country: vf };
  return undefined;
}

export function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** Teilt einen Hostnamen in Rest + offizielle Endung (z. B. „eta.“ + „gov.lk“) */
export function splitDomain(u: string): [string, string] {
  const h = host(u), p = h.split('.');
  const n = p.length > 2 && /^(gov|govt|go|gob|gc)$/.test(p[p.length - 2]) ? 2 : 1;
  const tail = p.slice(-n).join('.');
  return [h.slice(0, h.length - tail.length), tail];
}

export type LinkCheck = { tone: Tone; title: string; text: string; host: string };
const OFFICIAL = DATA.filter((d) => d.url).map((d) => ({ h: host(d.url!), d }));

/** Prüft einen eingefügten Link gegen die hinterlegten offiziellen Portale */
export function checkLink(input: string): LinkCheck | undefined {
  let raw = input.trim();
  if (!raw) return undefined;
  if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
  const h = host(raw);
  if (!h) return { tone: 'warn', title: 'Keine Web-Adresse', text: 'Bitte den kompletten Link einfügen.', host: '' };
  const match = OFFICIAL.filter((o) => h === o.h || h.endsWith('.' + o.h));
  if (match.length) {
    const names = [...new Set(match.map((m) => `${m.d.c} (${m.d.what})`))].join(', ');
    return { tone: 'ok', title: 'Offiziell.', text: `Regierungsportal für ${names}.`, host: h };
  }
  if (/(\.gov(\.[a-z]{2})?|\.govt\.[a-z]{2}|\.go\.[a-z]{2}|\.gob\.[a-z]{2}|\.gc\.ca|canada\.ca)$/.test(h))
    return { tone: 'warn', title: 'Wahrscheinlich staatlich,', text: 'aber nicht in dieser Liste. Zur Sicherheit über das Auswärtige Amt gegenprüfen.', host: h };
  if (/(esta|eta|visa|visum|evisa|tdac|mdac|arrival|travel|immigration)/.test(h))
    return { tone: 'bad', title: 'Nicht offiziell.', text: 'Kein Regierungsportal. Solche Seiten verlangen meist ein Vielfaches der offiziellen Gebühr. Land oben suchen und den offiziellen Link nutzen.', host: h };
  return { tone: 'warn', title: 'Unbekannt.', text: 'Nicht als offizielles Portal hinterlegt. Nicht dort bezahlen, bevor du es über das Auswärtige Amt geprüft hast.', host: h };
}

export const isDomestic = (country: string) => !country || ['de', 'deutschland', 'germany'].includes(norm(country));
