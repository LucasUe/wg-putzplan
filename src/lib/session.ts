/** Kleine Browser-Einstellungen pro Gerät (localStorage). Fehler werden verschluckt. */

const K_MEMBER = 'wg-putzplan:member';
const K_ONLY = 'wg-putzplan:onlyMine';
const K_DEVICE = 'wg-putzplan:device';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // privates Fenster / blockierter Speicher: ohne Merken weitermachen
  }
}

export const getStoredMemberId = (): string | null => read(K_MEMBER);
export const setStoredMemberId = (id: string | null): void => write(K_MEMBER, id);
export const getStoredOnlyMine = (): boolean => read(K_ONLY) === '1';
export const setStoredOnlyMine = (on: boolean): void => write(K_ONLY, on ? '1' : '0');

/** Zufällige Geräte-ID, für die Push-Subscription-ID. */
export function getDeviceId(): string {
  const existing = read(K_DEVICE);
  if (existing) return existing;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  write(K_DEVICE, id);
  return id;
}
