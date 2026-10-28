import { sha256Hex } from '../crypto';
import { SEED_PIN, seedHousehold, seedTasks } from '../seed';
import type { Absence, Completion, Household, Override, PushSubscriptionRecord, Snapshot, Task } from '../types';
import type { Store, Unsubscribe } from './types';

/** Demo-Modus: alles im localStorage dieses Browsers. */

const KEY = 'wg-putzplan:demo:v1';
const EMPTY_OVERRIDES: Override[] = [];

interface LocalData {
  household: Household;
  tasks: Task[];
  absences: Absence[];
  completions: Completion[];
  /** fehlt in älteren Demo-Daten */
  overrides?: Override[];
  snapshots: Snapshot[];
  pushSubscriptions: PushSubscriptionRecord[];
}

function readStorage(): LocalData | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalData) : null;
  } catch {
    return null;
  }
}

function writeStorage(data: LocalData): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Speicher voll oder blockiert: Demo läuft im Speicher weiter.
  }
}

export async function createLocalStore(): Promise<Store> {
  let data: LocalData =
    readStorage() ??
    (await (async () => {
      const seeded: LocalData = {
        household: seedHousehold(await sha256Hex(SEED_PIN)),
        tasks: seedTasks(),
        absences: [],
        completions: [],
        snapshots: [],
        pushSubscriptions: [],
      };
      writeStorage(seeded);
      return seeded;
    })());

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());

  const commit = (next: LocalData) => {
    data = next;
    writeStorage(data);
    notify();
  };

  const subscribe = <T>(select: () => T, cb: (v: T) => void): Unsubscribe => {
    const fn = () => cb(select());
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  };

  // Änderungen aus anderen Tabs übernehmen.
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      const fresh = readStorage();
      if (fresh) {
        data = fresh;
        notify();
      }
    });
  } catch {
    // ohne window (z. B. Tests) kein Storage-Listener
  }

  return {
    mode: 'local',
    subscribeHousehold: (cb) => subscribe(() => data.household, cb),
    subscribeTasks: (cb) => subscribe(() => data.tasks, cb),
    subscribeAbsences: (cb) => subscribe(() => data.absences, cb),
    subscribeCompletions: (cb) => subscribe(() => data.completions, cb),
    subscribeSnapshots: (cb) => subscribe(() => data.snapshots, cb),
    subscribeOverrides: (cb) => subscribe(() => data.overrides ?? EMPTY_OVERRIDES, cb),

    async updateHousehold(patch) {
      commit({ ...data, household: { ...data.household, ...patch } });
    },
    async saveTask(task) {
      const tasks = data.tasks.some((t) => t.id === task.id)
        ? data.tasks.map((t) => (t.id === task.id ? task : t))
        : [...data.tasks, task];
      commit({ ...data, tasks });
    },
    async saveAbsence(absence) {
      const absences = data.absences.some((a) => a.id === absence.id)
        ? data.absences.map((a) => (a.id === absence.id ? absence : a))
        : [...data.absences, absence];
      commit({ ...data, absences });
    },
    async deleteAbsence(id) {
      commit({ ...data, absences: data.absences.filter((a) => a.id !== id) });
    },
    async saveCompletion(completion) {
      const completions = data.completions.some((c) => c.id === completion.id)
        ? data.completions.map((c) => (c.id === completion.id ? completion : c))
        : [...data.completions, completion];
      commit({ ...data, completions });
    },
    async deleteCompletion(id) {
      commit({ ...data, completions: data.completions.filter((c) => c.id !== id) });
    },
    async saveSnapshot(snapshot) {
      const snapshots = data.snapshots.some((s) => s.periodKey === snapshot.periodKey)
        ? data.snapshots
        : [...data.snapshots, snapshot];
      commit({ ...data, snapshots });
    },
    async saveOverride(override) {
      const overrides = [...(data.overrides ?? []).filter((o) => o.id !== override.id), override];
      commit({ ...data, overrides });
    },
    async deleteOverride(id) {
      commit({ ...data, overrides: (data.overrides ?? []).filter((o) => o.id !== id) });
    },
    async savePushSubscription(record) {
      const pushSubscriptions = [...data.pushSubscriptions.filter((r) => r.id !== record.id), record];
      commit({ ...data, pushSubscriptions });
    },
  };
}
