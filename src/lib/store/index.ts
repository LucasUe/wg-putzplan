import { firebaseConfig } from '../../firebaseConfig';
import { createLocalStore } from './localStore';
import type { Store } from './types';

export type { Store, Unsubscribe } from './types';

/** Firestore, wenn eine Config mit apiKey existiert. Sonst Demo-Modus (localStorage). */
export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey.trim().length > 0;
}

/** Firebase wird nur geladen, wenn eine Config gesetzt ist (kleineres Bundle im Demo-Modus). */
export async function createStore(): Promise<Store> {
  if (!isFirebaseConfigured()) return createLocalStore();
  const { createFirestoreStore } = await import('./firestoreStore');
  return createFirestoreStore();
}
