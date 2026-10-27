import type { Household } from './types';

/** SHA-256 als Hex-String (Web Crypto, auch in Node 19+ verfügbar). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Zufällige ID für neue Dokumente. */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** PIN-Hash einer Person: eigener Eintrag in `pins`, sonst der alte gemeinsame WG-PIN. */
export function pinHashFor(household: Household, memberId: string): string | undefined {
  return household.pins?.[memberId] ?? household.pinHash;
}
