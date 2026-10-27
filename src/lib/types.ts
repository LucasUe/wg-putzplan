import type { Cadence, Day, TaskWindow } from './periods';

export interface Member {
  id: string;
  name: string;
  color: string;
}

export interface Household {
  members: Member[];
  /** PIN-Hash je Person (memberId -> SHA-256). */
  pins?: Record<string, string>;
  /** Alter gemeinsamer WG-PIN; gilt nur noch für Personen ohne eigenen Eintrag in `pins`. */
  pinHash?: string;
  startDate: Day;
}

export interface Task {
  id: string;
  name: string;
  icon: string;
  cadence: Cadence;
  window: TaskWindow;
  weight: number;
  active: boolean;
  /** ISO-Zeitstempel */
  createdAt: string;
}

export interface Absence {
  id: string;
  memberId: string;
  /** inklusiv, Kalendertag */
  from: Day;
  /** inklusiv, Kalendertag */
  to: Day;
  note?: string;
}

export interface Completion {
  /** Dokument-ID: `${periodKey}_${taskId}` */
  id: string;
  periodKey: string;
  taskId: string;
  doneBy: string;
  /** ISO-Zeitstempel */
  doneAt: string;
}

export interface SnapshotItem {
  /** null = niemand verfügbar */
  memberId: string | null;
  weight: number;
  /** Verfügbare Personen für das Fenster dieser Aufgabe, eingefroren */
  eligible: string[];
}

export interface Snapshot {
  /** "2026-W45" bzw. "2026-11" */
  periodKey: string;
  cadence: Cadence;
  /** taskId -> Eintrag */
  items: Record<string, SnapshotItem>;
  /** ISO-Zeitstempel des Einfrierens */
  savedAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  memberId: string;
  subscription: PushSubscriptionJSON;
}
