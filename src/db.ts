import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { todayISO } from './lib/dates';
import { DEFAULT_SNIPPETS } from './lib/snippets';
import { DEFAULT_SETTINGS, type CalendarEvent, type ServiceReport, type Settings, type Snippet, type TimeEntry, type Trip } from './lib/types';

class TechDeskDB extends Dexie {
  events!: Table<CalendarEvent, string>;
  times!: Table<TimeEntry, string>;
  snippets!: Table<Snippet, string>;
  reports!: Table<ServiceReport, string>;
  trips!: Table<Trip, string>;
  settings!: Table<Settings, string>;
  constructor() {
    super('techdesk');
    this.version(1).stores({
      events: 'id, startDate, endDate, type',
      times: 'id, date, kind',
      snippets: 'id, category, title',
      reports: 'id, updatedAt, customer',
      trips: 'id, departure',
      settings: 'id',
    });
    this.on('populate', (tx) => {
      tx.table('snippets').bulkAdd(DEFAULT_SNIPPETS);
      tx.table('settings').add({ ...DEFAULT_SETTINGS, overtimeStartDate: todayISO() });
    });
  }
}

export const db = new TechDeskDB();

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'), []);
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = (await db.settings.get('main')) ?? DEFAULT_SETTINGS;
  await db.settings.put({ ...cur, ...patch, id: 'main' });
}

const TABLES = ['events', 'times', 'snippets', 'reports', 'trips', 'settings'] as const;

export async function exportAll(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return JSON.stringify({ app: 'techdesk', version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}

/** mode 'merge' fügt hinzu/überschreibt gleiche IDs, 'replace' ersetzt alles */
export async function importAll(json: string, mode: 'merge' | 'replace') {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'techdesk' || !parsed.data) throw new Error('Keine gültige TechDesk-Sicherung');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows = parsed.data[t];
      if (!Array.isArray(rows)) continue;
      if (mode === 'replace') await db.table(t).clear();
      await db.table(t).bulkPut(rows);
    }
  });
}

/** Nur Vorlagen teilen (für Kollegen) */
export async function exportSnippets(): Promise<string> {
  return JSON.stringify({ app: 'techdesk', version: 1, exportedAt: new Date().toISOString(), data: { snippets: await db.snippets.toArray() } }, null, 2);
}
