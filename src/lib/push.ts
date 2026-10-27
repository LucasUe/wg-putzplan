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

/** Benachrichtigungen erlauben, Push-Subscription anlegen und im Store speichern. */
export async function enablePush(store: Store, memberId: string): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
    const id = `${memberId}_${(await sha256Hex(getDeviceId())).slice(0, 16)}`;
    await store.savePushSubscription({ id, memberId, subscription: sub.toJSON() as PushSubscriptionJSON });
    return 'ok';
  } catch {
    return 'error';
  }
}
