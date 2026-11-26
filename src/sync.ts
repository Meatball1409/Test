import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { cloudEnabled, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { db, getMeta, setMeta, wipeLocal } from './db';
import { afterPush, localChanges, planPull, SYNC_TABLES, type Hashes, type RemoteRow, type SyncTable } from './lib/syncCore';

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export type SyncState = { status: 'idle' | 'syncing' | 'offline' | 'error'; lastSync?: string; error?: string };
let state: SyncState = { status: 'idle' };
const listeners = new Set<(s: SyncState) => void>();
const emit = (s: Partial<SyncState>) => { state = { ...state, ...s }; listeners.forEach((l) => l(state)); };
export const getSyncState = () => state;
export function onSyncState(l: (s: SyncState) => void) { listeners.add(l); return () => { listeners.delete(l); }; }

let running: Promise<void> | null = null;
let again = false;

/** Abgleich: lokale Änderungen hochladen, dann Änderungen anderer Geräte holen. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await syncOnce(); } while (again);
    } finally { running = null; }
  })();
  return running;
}

async function syncOnce() {
  if (!supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  if (!navigator.onLine) { emit({ status: 'offline' }); return; }
  emit({ status: 'syncing', error: undefined });
  try {
    let hashes = (await getMeta<Hashes>('hashes')) ?? {};
    const initialized = await getMeta<boolean>('initialized');

    // 1. Beim ersten Mal auf diesem Gerät: erst alles vom Server holen
    if (!initialized) {
      hashes = await pull(null, hashes);
      await setMeta('initialized', true);
    }

    // 2. Lokale Änderungen hochladen
    const local = {} as Record<SyncTable, { id: string }[]>;
    for (const t of SYNC_TABLES) local[t] = await db.table(t).toArray();
    const changes = localChanges(local, hashes);
    for (let i = 0; i < changes.length; i += 200) {
      const chunk = changes.slice(i, i + 200);
      const { error } = await supabase.from('records').upsert(chunk, { onConflict: 'user_id,tbl,id' });
      if (error) throw error;
      hashes = afterPush(hashes, chunk);
      await setMeta('hashes', hashes);
    }

    // 3. Änderungen von anderen Geräten holen
    hashes = await pull((await getMeta<string>('lastPull')) ?? null, hashes);
    const now = new Date().toISOString();
    await setMeta('lastSync', now);
    emit({ status: 'idle', lastSync: now });
  } catch (e) {
    emit({ status: navigator.onLine ? 'error' : 'offline', error: (e as Error).message });
  }
}

async function pull(since: string | null, hashes: Hashes): Promise<Hashes> {
  const rows: RemoteRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase!.from('records').select('tbl,id,data,deleted,updated_at').order('updated_at').range(from, from + 999);
    if (since) q = q.gte('updated_at', since);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data as RemoteRow[]));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) return hashes;
  const plan = planPull(rows, hashes);
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.meta], async () => {
    pausedHooks = true;
    try {
      for (const [t, list] of Object.entries(plan.put)) await db.table(t).bulkPut(list);
      for (const [t, ids] of Object.entries(plan.del)) await db.table(t).bulkDelete(ids);
      await db.meta.put({ key: 'hashes', value: plan.hashes });
      if (plan.maxTs) await db.meta.put({ key: 'lastPull', value: plan.maxTs });
    } finally { pausedHooks = false; }
  });
  return plan.hashes;
}

/** Lokale Änderungen lösen nach kurzer Pause einen Abgleich aus */
let pausedHooks = false;
let timer: number | undefined;
function scheduleSync() {
  if (pausedHooks || !supabase) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void syncNow(); }, 1500);
}
if (supabase) {
  for (const t of SYNC_TABLES) {
    const table = db.table(t);
    table.hook('creating', () => { scheduleSync(); });
    table.hook('updating', () => { scheduleSync(); });
    table.hook('deleting', () => { scheduleSync(); });
  }
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncNow(); });
  window.setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 60_000);
}

/** Nach der Anmeldung: Gerät dem Nutzer zuordnen. Gehörten die Daten jemand anderem → vorher löschen. */
export async function prepareForUser(session: Session) {
  const owner = await getMeta<string>('owner');
  if (owner && owner !== session.user.id) await wipeLocal();
  // owner fehlt: Daten aus der Zeit vor der Anmeldung werden ins eigene Konto übernommen
  await setMeta('owner', session.user.id);
  await syncNow();
}

/** Abmelden: erst noch abgleichen, dann alle Daten von diesem Gerät entfernen */
export async function signOut() {
  if (!supabase) return;
  if (navigator.onLine) await syncNow();
  await wipeLocal();
  await supabase.auth.signOut();
}

export async function pendingChanges(): Promise<number> {
  const hashes = (await getMeta<Hashes>('hashes')) ?? {};
  const local = {} as Record<SyncTable, { id: string }[]>;
  for (const t of SYNC_TABLES) local[t] = await db.table(t).toArray();
  return localChanges(local, hashes).length;
}
