import type { Absence, Completion, Household, Override, PushSubscriptionRecord, Snapshot, Task } from '../types';

export type Unsubscribe = () => void;

/**
 * Gemeinsamer Daten-Layer für Firestore (produktiv) und localStorage (Demo).
 * Alle Lese-Methoden liefern den aktuellen Stand sofort und danach bei jeder Änderung.
 */
export interface Store {
  readonly mode: 'firestore' | 'local';
  subscribeHousehold(cb: (h: Household | null) => void): Unsubscribe;
  subscribeTasks(cb: (tasks: Task[]) => void): Unsubscribe;
  subscribeAbsences(cb: (absences: Absence[]) => void): Unsubscribe;
  subscribeCompletions(cb: (completions: Completion[]) => void): Unsubscribe;
  subscribeSnapshots(cb: (snapshots: Snapshot[]) => void): Unsubscribe;
  subscribeOverrides(cb: (overrides: Override[]) => void): Unsubscribe;

  updateHousehold(patch: Partial<Household>): Promise<void>;
  saveTask(task: Task): Promise<void>;
  saveAbsence(absence: Absence): Promise<void>;
  deleteAbsence(id: string): Promise<void>;
  saveCompletion(completion: Completion): Promise<void>;
  deleteCompletion(id: string): Promise<void>;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  saveOverride(override: Override): Promise<void>;
  deleteOverride(id: string): Promise<void>;
  savePushSubscription(record: PushSubscriptionRecord): Promise<void>;
}
