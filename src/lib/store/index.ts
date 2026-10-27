import { firebaseConfig } from '../../firebaseConfig';
import { createFirestoreStore } from './firestoreStore';
import { createLocalStore } from './localStore';
import type { Store } from './types';

export type { Store, Unsubscribe } from './types';

/** Firestore, wenn eine Config mit apiKey existiert. Sonst Demo-Modus (localStorage). */
export function isFirebaseConfigured(): boolean {
  return firebaseConfig.apiKey.trim().length > 0;
}

export async function createStore(): Promise<Store> {
  return isFirebaseConfigured() ? createFirestoreStore() : createLocalStore();
}
