import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { firebaseConfig } from '../../firebaseConfig';
import { sha256Hex } from '../crypto';
import { SEED_PIN, seedHousehold, seedTasks } from '../seed';
import type { Absence, Completion, Household, Override, PushSubscriptionRecord, Snapshot, Task } from '../types';
import type { Store, Unsubscribe } from './types';

/** Produktiv: Firestore mit Live-Sync. Collections siehe PLAN.md Abschnitt 2. */

const HOUSEHOLD_PATH = ['household', 'main'] as const;

function listen<T>(
  q: Query<DocumentData>,
  map: (snap: QuerySnapshot<DocumentData>) => T,
  cb: (v: T) => void,
): Unsubscribe {
  return onSnapshot(q, (snap) => cb(map(snap)));
}

export async function createFirestoreStore(): Promise<Store> {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db: Firestore = getFirestore(app);

  // Erststart: Haushalt und Aufgaben anlegen, falls leer.
  const hhRef = doc(db, ...HOUSEHOLD_PATH);
  const hhSnap = await getDoc(hhRef);
  if (!hhSnap.exists()) {
    await setDoc(hhRef, seedHousehold(await sha256Hex(SEED_PIN)));
  }
  const taskSnap = await getDocs(collection(db, 'tasks'));
  if (taskSnap.empty) {
    for (const t of seedTasks()) await setDoc(doc(db, 'tasks', t.id), t);
  }

  return {
    mode: 'firestore',

    subscribeHousehold(cb) {
      return onSnapshot(hhRef, (snap) => cb(snap.exists() ? (snap.data() as Household) : null));
    },
    subscribeTasks(cb) {
      return listen(collection(db, 'tasks'), (s) => s.docs.map((d) => d.data() as Task), cb);
    },
    subscribeAbsences(cb) {
      return listen(collection(db, 'absences'), (s) => s.docs.map((d) => d.data() as Absence), cb);
    },
    subscribeCompletions(cb) {
      return listen(collection(db, 'completions'), (s) => s.docs.map((d) => d.data() as Completion), cb);
    },
    subscribeSnapshots(cb) {
      return listen(collection(db, 'snapshots'), (s) => s.docs.map((d) => d.data() as Snapshot), cb);
    },
    subscribeOverrides(cb) {
      return listen(collection(db, 'overrides'), (s) => s.docs.map((d) => d.data() as Override), cb);
    },

    async updateHousehold(patch) {
      await updateDoc(hhRef, patch as DocumentData);
    },
    async saveTask(task) {
      await setDoc(doc(db, 'tasks', task.id), task);
    },
    async saveAbsence(absence) {
      await setDoc(doc(db, 'absences', absence.id), absence);
    },
    async deleteAbsence(id) {
      await deleteDoc(doc(db, 'absences', id));
    },
    async saveCompletion(completion) {
      await setDoc(doc(db, 'completions', completion.id), completion);
    },
    async deleteCompletion(id) {
      await deleteDoc(doc(db, 'completions', id));
    },
    async saveSnapshot(snapshot) {
      await setDoc(doc(db, 'snapshots', snapshot.periodKey), snapshot);
    },
    async saveOverride(override) {
      // Firestore lehnt undefined-Felder ab
      const clean = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined));
      await setDoc(doc(db, 'overrides', override.id), clean);
    },
    async deleteOverride(id) {
      await deleteDoc(doc(db, 'overrides', id));
    },
    async savePushSubscription(record: PushSubscriptionRecord) {
      await setDoc(doc(db, 'pushSubscriptions', record.id), {
        memberId: record.memberId,
        subscription: record.subscription,
      });
    },
  };
}
