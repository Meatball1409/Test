import { getMeta, setMeta } from './db';
import { newRecoveryCode, normalizeRecovery, PBKDF2_ITERATIONS, RECOVERY_ITERATIONS, unwrapDek, wrapDek, generateDek, type Wrapped } from './lib/e2e';
import { supabase } from './sync';

/** Datenschlüssel dieses Geräts (liegt nur lokal, wird beim Abmelden gelöscht) */
export const getDek = () => getMeta<CryptoKey>('dek');

/** Passwort aus dem Anmeldeformular – nur kurz im Speicher, damit man es nicht zweimal eingeben muss */
let pending: string | null = null;
export const rememberPassword = (pw: string) => { pending = pw; };
export const takePassword = () => { const p = pending; pending = null; return p; };

type KeyRow = { pw: Wrapped; recovery: Wrapped };
async function loadKeys(): Promise<KeyRow | null> {
  const { data, error } = await supabase!.from('user_keys').select('pw,recovery').maybeSingle();
  if (error) throw error;
  return data as KeyRow | null;
}

export type UnlockResult = { ok: true; recoveryCode?: string } | { ok: false; reason: 'needs-recovery' };

/** Mit Passwort entsperren; beim allerersten Mal Schlüssel + Wiederherstellungscode anlegen */
export async function unlockWithPassword(password: string): Promise<UnlockResult> {
  const keys = await loadKeys();
  if (!keys) {
    const dek = await generateDek();
    const recoveryCode = newRecoveryCode();
    const row = { pw: await wrapDek(dek, password, PBKDF2_ITERATIONS), recovery: await wrapDek(dek, normalizeRecovery(recoveryCode), RECOVERY_ITERATIONS) };
    const { error } = await supabase!.from('user_keys').insert(row);
    if (error) throw error;
    await setMeta('dek', dek);
    return { ok: true, recoveryCode };
  }
  try {
    await setMeta('dek', await unwrapDek(keys.pw, password));
    return { ok: true };
  } catch {
    // Passwort wurde außerhalb der App geändert (z. B. vom Admin zurückgesetzt)
    return { ok: false, reason: 'needs-recovery' };
  }
}

/** Mit Wiederherstellungscode entsperren und den Schlüssel an das aktuelle Passwort binden */
export async function unlockWithRecovery(code: string, currentPassword: string): Promise<boolean> {
  const keys = await loadKeys();
  if (!keys) return false;
  let dek: CryptoKey;
  try { dek = await unwrapDek(keys.recovery, normalizeRecovery(code)); } catch { return false; }
  const { error } = await supabase!.from('user_keys').update({ pw: await wrapDek(dek, currentPassword, PBKDF2_ITERATIONS), updated_at: new Date().toISOString() }).not('user_id', 'is', null);
  if (error) throw error;
  await setMeta('dek', dek);
  return true;
}

/** Nach Passwortänderung: Schlüssel mit dem neuen Passwort sichern */
export async function rewrapForPassword(newPassword: string) {
  const dek = await getDek();
  if (!dek) throw new Error('Kein Schlüssel auf diesem Gerät');
  const { error } = await supabase!.from('user_keys').update({ pw: await wrapDek(dek, newPassword, PBKDF2_ITERATIONS), updated_at: new Date().toISOString() }).not('user_id', 'is', null);
  if (error) throw error;
}

/** Neuen Wiederherstellungscode erzeugen (der alte wird ungültig) */
export async function renewRecoveryCode(): Promise<string> {
  const dek = await getDek();
  if (!dek) throw new Error('Kein Schlüssel auf diesem Gerät');
  const code = newRecoveryCode();
  const { error } = await supabase!.from('user_keys').update({ recovery: await wrapDek(dek, normalizeRecovery(code), RECOVERY_ITERATIONS), updated_at: new Date().toISOString() }).not('user_id', 'is', null);
  if (error) throw error;
  return code;
}

/** Letzter Ausweg ohne Code: alle Server-Daten dieses Nutzers löschen und neu beginnen */
export async function resetEncryptedData(password: string): Promise<string> {
  const del1 = await supabase!.from('records').delete().not('id', 'is', null);
  if (del1.error) throw del1.error;
  const del2 = await supabase!.from('user_keys').delete().not('user_id', 'is', null);
  if (del2.error) throw del2.error;
  const r = await unlockWithPassword(password);
  if (!r.ok || !r.recoveryCode) throw new Error('Neuanlage fehlgeschlagen');
  return r.recoveryCode;
}
