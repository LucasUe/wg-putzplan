import { VAPID_PUBLIC_KEY } from '../config';
import { sha256Hex } from './crypto';
import { getDeviceId } from './session';
import type { Store } from './store';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'error';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const K_DISABLED = 'wg-putzplan:pushDisabled';
const K_SUB_ID = 'wg-putzplan:pushSubId';
const K_LAST_SYNC = 'wg-putzplan:pushLastSync';
const SYNC_INTERVAL_MS = 10 * 60_000;

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Speicher blockiert: ohne Merken weitermachen
  }
}

export function isPushDisabled(): boolean {
  return lsGet(K_DISABLED) === '1';
}

/** Vergleicht den applicationServerKey einer Subscription mit unserem VAPID-Key. */
function keyMatches(sub: PushSubscription): boolean {
  const key = sub.options?.applicationServerKey;
  if (!key) return true; // Browser liefert ihn nicht: nicht unnötig neu anlegen
  const have = new Uint8Array(key);
  const want = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}

/** Aktuelle Subscription holen; fehlt sie oder passt der Schlüssel nicht, neu anlegen. */
async function currentSubscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !keyMatches(sub)) {
    await sub.unsubscribe();
    sub = null;
  }
  return (
    sub ??
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
  );
}

/** Subscription speichern; hat sich die Dokument-ID geändert, das alte Dokument löschen. */
async function storeSubscription(store: Store, memberId: string, sub: PushSubscription): Promise<void> {
  const id = `${memberId}_${(await sha256Hex(getDeviceId())).slice(0, 16)}`;
  await store.savePushSubscription({ id, memberId, subscription: sub.toJSON() as PushSubscriptionJSON });
  const previous = lsGet(K_SUB_ID);
  if (previous && previous !== id) await store.deletePushSubscription(previous);
  lsSet(K_SUB_ID, id);
}

/**
 * Hält die gespeicherte Push-Adresse aktuell (Browser/iOS können sie jederzeit erneuern).
 * Läuft beim Start und beim Zurückkehren in die App, höchstens alle 10 Minuten.
 */
export async function syncPush(store: Store, memberId: string, force = false): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || isPushDisabled()) return;
    const last = Number(lsGet(K_LAST_SYNC) ?? 0);
    if (!force && Date.now() - last < SYNC_INTERVAL_MS) return;
    lsSet(K_LAST_SYNC, String(Date.now()));
    await storeSubscription(store, memberId, await currentSubscription());
  } catch (e) {
    console.warn('Push-Abgleich fehlgeschlagen', e);
  }
}

/** Sind Benachrichtigungen auf diesem Gerät aktiv? */
export async function pushActive(): Promise<boolean> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted' || isPushDisabled()) return false;
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/** Benachrichtigungen auf diesem Gerät abschalten und die gespeicherte Adresse löschen. */
export async function disablePush(store: Store): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {
    console.warn('Abmelden vom Push-Dienst fehlgeschlagen', e);
  }
  const id = lsGet(K_SUB_ID);
  if (id) await store.deletePushSubscription(id);
  lsSet(K_DISABLED, '1');
  lsSet(K_SUB_ID, null);
}

/** Benachrichtigungen erlauben, Push-Subscription anlegen und im Store speichern. */
export async function enablePush(store: Store, memberId: string): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    lsSet(K_DISABLED, null);
    await storeSubscription(store, memberId, await currentSubscription());
    lsSet(K_LAST_SYNC, String(Date.now()));
    return 'ok';
  } catch {
    return 'error';
  }
}
