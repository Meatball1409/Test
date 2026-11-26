/** Reine Abgleich-Logik (ohne Datenbank/Netz) – damit testbar. */

export const SYNC_TABLES = ['events', 'times', 'snippets', 'reports', 'trips', 'settings'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export interface RemoteRow { tbl: SyncTable; id: string; data: Record<string, unknown> | null; deleted: boolean; updated_at: string }
export interface PushRow { tbl: SyncTable; id: string; data: Record<string, unknown> | null; deleted: boolean }
export type Hashes = Record<string, string>; // "tbl/id" → Hash des zuletzt abgeglichenen Inhalts

/** JSON mit sortierten Schlüsseln – der Server (jsonb) sortiert ebenfalls, so bleiben Hashes stabil */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map((x) => stableStringify(x === undefined ? null : x)).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

export function hash(v: unknown): string {
  const s = stableStringify(v);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + s.length.toString(36);
}

export const key = (tbl: string, id: string) => `${tbl}/${id}`;

/** Lokale Änderungen seit dem letzten Abgleich: neue/geänderte Zeilen und gelöschte Zeilen */
export function localChanges(local: Record<SyncTable, { id: string }[]>, hashes: Hashes): PushRow[] {
  const out: PushRow[] = [];
  const seen = new Set<string>();
  for (const tbl of SYNC_TABLES) {
    for (const row of local[tbl] ?? []) {
      const k = key(tbl, row.id);
      seen.add(k);
      if (hashes[k] !== hash(row)) out.push({ tbl, id: row.id, data: JSON.parse(JSON.stringify(row)), deleted: false });
    }
  }
  for (const k of Object.keys(hashes)) {
    if (seen.has(k) || hashes[k] === 'deleted') continue;
    const i = k.indexOf('/');
    out.push({ tbl: k.slice(0, i) as SyncTable, id: k.slice(i + 1), data: null, deleted: true });
  }
  return out;
}

/** Nach erfolgreichem Hochladen: Hashes auf den hochgeladenen Stand setzen */
export function afterPush(hashes: Hashes, pushed: PushRow[]): Hashes {
  const h = { ...hashes };
  for (const p of pushed) {
    if (p.deleted) delete h[key(p.tbl, p.id)];
    else h[key(p.tbl, p.id)] = hash(p.data);
  }
  return h;
}

/** Vom Server geholte Zeilen: was lokal geschrieben bzw. gelöscht werden muss */
export function planPull(rows: RemoteRow[], hashes: Hashes) {
  const put: Record<string, Record<string, unknown>[]> = {};
  const del: Record<string, string[]> = {};
  const h = { ...hashes };
  let maxTs = '';
  for (const r of rows) {
    if (!SYNC_TABLES.includes(r.tbl)) continue;
    if (r.updated_at > maxTs) maxTs = r.updated_at;
    const k = key(r.tbl, r.id);
    if (r.deleted || !r.data) {
      (del[r.tbl] ??= []).push(r.id);
      delete h[k];
    } else {
      (put[r.tbl] ??= []).push(r.data);
      h[k] = hash(r.data);
    }
  }
  return { put, del, hashes: h, maxTs };
}
