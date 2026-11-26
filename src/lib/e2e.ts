/**
 * Ende-zu-Ende-Verschlüsselung (Web Crypto API, läuft komplett auf dem Gerät).
 *
 * - Jeder Nutzer hat einen zufälligen Datenschlüssel (DEK, AES-GCM 256 Bit).
 * - Der DEK wird mit einem Schlüssel aus dem Passwort (PBKDF2-SHA256, 600.000 Runden)
 *   und zusätzlich mit einem Wiederherstellungscode (128 Bit Zufall) verschlüsselt („gewrappt“).
 * - Jeder Datensatz wird einzeln mit AES-GCM verschlüsselt; Tabelle + ID sind als
 *   Zusatzdaten (AAD) gebunden, damit Datensätze nicht vertauscht werden können.
 * Der Server sieht nie Passwort, Datenschlüssel oder Klartext.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 600_000;
export const RECOVERY_ITERATIONS = 100_000;

export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKek(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

export function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export interface Wrapped { salt: string; iterations: number; iv: string; key: string }

export async function wrapDek(dek: CryptoKey, secret: string, iterations: number): Promise<Wrapped> {
  const salt = rand(16), iv = rand(12);
  const kek = await deriveKek(secret, salt, iterations);
  const key = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { salt: b64(salt), iterations, iv: b64(iv), key: b64(key) };
}

/** Wirft einen Fehler, wenn Passwort/Code nicht passt */
export async function unwrapDek(w: Wrapped, secret: string): Promise<CryptoKey> {
  const kek = await deriveKek(secret, unb64(w.salt), w.iterations);
  return crypto.subtle.unwrapKey('raw', unb64(w.key), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export interface Sealed { v: 1; iv: string; ct: string }

export async function seal(dek: CryptoKey, aad: string, data: unknown): Promise<Sealed> {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, dek, enc.encode(JSON.stringify(data)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export async function open<T = Record<string, unknown>>(dek: CryptoKey, aad: string, s: Sealed): Promise<T> {
  if (!s || s.v !== 1 || !s.iv || !s.ct) throw new Error('Nicht verschlüsselt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv), additionalData: enc.encode(aad) }, dek, unb64(s.ct));
  return JSON.parse(dec.decode(pt)) as T;
}

/** Wiederherstellungscode: 26 Zeichen Base32 (128 Bit), z. B. 7KQ2-M9XA-… (ohne 0/1/I/L/O/U) */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode(): string {
  const bytes = rand(26);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return chars.match(/.{1,4}/g)!.join('-');
}
export const normalizeRecovery = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
