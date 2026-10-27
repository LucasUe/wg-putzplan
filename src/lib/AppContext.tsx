import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { berlinDay } from './periods';
import { buildSnapshot, computeSchedule, type PeriodSchedule, type Schedule } from './schedule';
import { createStore, type Store, type Unsubscribe } from './store';
import { getStoredMemberId, setStoredMemberId } from './session';
import type { Absence, Completion, Household, Member, Snapshot, Task } from './types';

const DAY_MS = 86_400_000;
/** Wie weit in die Zukunft der Plan berechnet wird. */
const HORIZON_DAYS = 100;

export interface AppValue {
  store: Store;
  mode: 'firestore' | 'local';
  household: Household;
  members: Member[];
  memberById: Map<string, Member>;
  tasks: Task[];
  taskById: Map<string, Task>;
  absences: Absence[];
  completions: Completion[];
  completionById: Map<string, Completion>;
  snapshots: Snapshot[];
  schedule: Schedule;
  now: Date;
  today: string;
  currentMember: Member | undefined;
  currentWeekly: PeriodSchedule | undefined;
  currentMonthly: PeriodSchedule | undefined;
  login: (memberId: string) => void;
  logout: () => void;
  toggleCompletion: (periodKey: string, taskId: string) => Promise<void>;
  onlyMine: boolean;
  setOnlyMine: (on: boolean) => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp außerhalb des AppProvider');
  return v;
}

export function completionId(periodKey: string, taskId: string): string {
  return `${periodKey}_${taskId}`;
}

type Loadable<T> = T | undefined;

/**
 * Lädt alle Daten aus dem Store, berechnet den Plan und speichert begonnene Perioden als Snapshot.
 * Gibt den Ladezustand zurück; die Provider-Kinder werden erst mit geladenen Daten gerendert.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [household, setHousehold] = useState<Loadable<Household | null>>(undefined);
  const [tasks, setTasks] = useState<Loadable<Task[]>>(undefined);
  const [absences, setAbsences] = useState<Loadable<Absence[]>>(undefined);
  const [completions, setCompletions] = useState<Loadable<Completion[]>>(undefined);
  const [snapshots, setSnapshots] = useState<Loadable<Snapshot[]>>(undefined);
  const [now, setNow] = useState<Date>(() => new Date());
  const [memberId, setMemberId] = useState<string | null>(() => getStoredMemberId());
  const [onlyMine, setOnlyMineState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('wg-putzplan:onlyMine') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const unsubs: Unsubscribe[] = [];
    let cancelled = false;
    createStore()
      .then((s) => {
        if (cancelled) return;
        setStore(s);
        unsubs.push(
          s.subscribeHousehold(setHousehold),
          s.subscribeTasks(setTasks),
          s.subscribeAbsences(setAbsences),
          s.subscribeCompletions(setCompletions),
          s.subscribeSnapshots(setSnapshots),
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  // Uhrzeit alle 30 Sekunden aktualisieren (Countdowns, Status).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const loaded =
    household !== undefined && tasks !== undefined && absences !== undefined && completions !== undefined && snapshots !== undefined;

  const safeTasks = useMemo(() => tasks ?? [], [tasks]);
  const safeAbsences = useMemo(() => absences ?? [], [absences]);
  const safeSnapshots = useMemo(() => snapshots ?? [], [snapshots]);
  const safeCompletions = useMemo(() => completions ?? [], [completions]);

  const schedule = useMemo<Schedule>(() => {
    if (!household) return { weekly: [], monthly: [] };
    return computeSchedule({
      members: household.members,
      tasks: safeTasks,
      absences: safeAbsences,
      startDate: household.startDate,
      snapshots: safeSnapshots,
      until: new Date(now.getTime() + HORIZON_DAYS * DAY_MS),
    });
  }, [household, safeTasks, safeAbsences, safeSnapshots, now]);

  // Begonnene Perioden ohne Snapshot einfrieren.
  const savingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!store || !loaded || !household) return;
    const today = berlinDay(now);
    for (const ps of [...schedule.weekly, ...schedule.monthly]) {
      if (ps.frozen || ps.period.startDay > today) continue;
      const k = `${ps.period.cadence}:${ps.period.key}`;
      if (savingRef.current.has(k)) continue;
      savingRef.current.add(k);
      store.saveSnapshot(buildSnapshot(ps, new Date().toISOString())).catch(() => savingRef.current.delete(k));
    }
  }, [store, loaded, household, schedule, now]);

  const members = useMemo(() => household?.members ?? [], [household]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const taskById = useMemo(() => new Map(safeTasks.map((t) => [t.id, t])), [safeTasks]);
  const completionById = useMemo(() => new Map(safeCompletions.map((c) => [c.id, c])), [safeCompletions]);
  const today = berlinDay(now);
  const currentWeekly = schedule.weekly.find((p) => p.period.startDay <= today && today <= p.period.endDay);
  const currentMonthly = schedule.monthly.find((p) => p.period.startDay <= today && today <= p.period.endDay);
  const currentMember = memberId ? memberById.get(memberId) : undefined;

  const login = useCallback((id: string) => {
    setStoredMemberId(id);
    setMemberId(id);
  }, []);
  const logout = useCallback(() => {
    setStoredMemberId(null);
    setMemberId(null);
  }, []);
  const setOnlyMine = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem('wg-putzplan:onlyMine', on ? '1' : '0');
    } catch {
      // ignorieren
    }
    setOnlyMineState(on);
  }, []);

  const toggleCompletion = useCallback(
    async (periodKey: string, taskId: string) => {
      if (!store || !memberId) return;
      const id = completionId(periodKey, taskId);
      if (completionById.has(id)) {
        await store.deleteCompletion(id);
      } else {
        await store.saveCompletion({ id, periodKey, taskId, doneBy: memberId, doneAt: new Date().toISOString() });
      }
    },
    [store, memberId, completionById],
  );

  if (error) {
    return <div className="p-6 text-red-600">Fehler beim Laden: {error}</div>;
  }
  if (!store || !loaded || !household) {
    return <div className="p-6 text-sm text-neutral-500">Lade WG-Putzplan …</div>;
  }

  const value: AppValue = {
    store,
    mode: store.mode,
    household,
    members,
    memberById,
    tasks: safeTasks,
    taskById,
    absences: safeAbsences,
    completions: safeCompletions,
    completionById,
    snapshots: safeSnapshots,
    schedule,
    now,
    today,
    currentMember,
    currentWeekly,
    currentMonthly,
    login,
    logout,
    toggleCompletion,
    onlyMine,
    setOnlyMine,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Status einer Aufgabe: erledigt, überfällig (Fenster vorbei) oder offen. */
export function taskStatus(windowEnd: Date, done: boolean, now: Date): 'offen' | 'erledigt' | 'überfällig' {
  if (done) return 'erledigt';
  return now > windowEnd ? 'überfällig' : 'offen';
}
