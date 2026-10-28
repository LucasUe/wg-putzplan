import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { berlinDay } from './periods';
import { buildSnapshot, computeSchedule, type PeriodSchedule, type Schedule, type TaskAssignment } from './schedule';
import { createStore, type Store, type Unsubscribe } from './store';
import { getStoredMemberId, setStoredMemberId } from './session';
import type { Absence, Completion, Household, Member, Override, Snapshot, Task } from './types';

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
  overrides: Override[];
  overrideById: Map<string, Override>;
  schedule: Schedule;
  now: Date;
  today: string;
  currentMember: Member | undefined;
  currentWeekly: PeriodSchedule | undefined;
  currentMonthly: PeriodSchedule | undefined;
  login: (memberId: string) => void;
  logout: () => void;
  toggleCompletion: (periodKey: string, taskId: string) => Promise<void>;
  /** Zuteilung einer Aufgabe in einer Periode (falls berechnet) */
  findAssignment: (periodKey: string, taskId: string) => { ps: PeriodSchedule; a: TaskAssignment } | undefined;
  /** Darf der aktuelle Nutzer abhaken bzw. zurücknehmen? */
  canToggle: (periodKey: string, taskId: string) => boolean;
  /** Eigene Aufgabe abgeben; mit swapTaskId als Tausch gegen eine Aufgabe des Empfängers */
  handOver: (periodKey: string, taskId: string, toMemberId: string, swapTaskId?: string) => Promise<void>;
  /** Abgabe bzw. Tausch zurücknehmen */
  revokeOverride: (periodKey: string, taskId: string) => Promise<void>;
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
  const [overrides, setOverrides] = useState<Loadable<Override[]>>(undefined);
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
          s.subscribeOverrides(setOverrides),
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
    household !== undefined && tasks !== undefined && absences !== undefined && completions !== undefined && snapshots !== undefined &&
    overrides !== undefined;

  const safeTasks = useMemo(() => tasks ?? [], [tasks]);
  const safeAbsences = useMemo(() => absences ?? [], [absences]);
  const safeSnapshots = useMemo(() => snapshots ?? [], [snapshots]);
  const safeCompletions = useMemo(() => completions ?? [], [completions]);
  const safeOverrides = useMemo(() => overrides ?? [], [overrides]);

  // Abgehakte Aufgaben bleiben bei der Person, die sie abgehakt hat.
  const pins = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const c of safeCompletions) (out[c.periodKey] ??= {})[c.taskId] = c.doneBy;
    return out;
  }, [safeCompletions]);

  const schedule = useMemo<Schedule>(() => {
    if (!household) return { weekly: [], monthly: [] };
    return computeSchedule({
      members: household.members,
      tasks: safeTasks,
      absences: safeAbsences,
      startDate: household.startDate,
      snapshots: safeSnapshots,
      until: new Date(now.getTime() + HORIZON_DAYS * DAY_MS),
      now,
      pins,
      overrides: safeOverrides,
    });
  }, [household, safeTasks, safeAbsences, safeSnapshots, pins, safeOverrides, now]);

  // Beendete Perioden ohne Snapshot einfrieren. Die laufende Periode bleibt live.
  const savingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!store || !loaded || !household) return;
    const today = berlinDay(now);
    for (const ps of [...schedule.weekly, ...schedule.monthly]) {
      if (ps.frozen || ps.period.endDay >= today) continue;
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

  const overrideById = useMemo(() => new Map(safeOverrides.map((o) => [o.id, o])), [safeOverrides]);

  const findAssignment = useCallback(
    (periodKey: string, taskId: string) => {
      for (const ps of [...schedule.weekly, ...schedule.monthly]) {
        if (ps.period.key !== periodKey) continue;
        const a = ps.assignments.find((x) => x.taskId === taskId);
        return a ? { ps, a } : undefined;
      }
      return undefined;
    },
    [schedule],
  );

  // Nur eigene Aufgaben abhaken; zurücknehmen nur, wer selbst abgehakt hat.
  const canToggle = useCallback(
    (periodKey: string, taskId: string) => {
      if (!memberId) return false;
      const done = completionById.get(completionId(periodKey, taskId));
      if (done) return done.doneBy === memberId;
      return findAssignment(periodKey, taskId)?.a.memberId === memberId;
    },
    [memberId, completionById, findAssignment],
  );

  const toggleCompletion = useCallback(
    async (periodKey: string, taskId: string) => {
      if (!store || !memberId) return;
      if (!canToggle(periodKey, taskId)) throw new Error('Nur eigene Aufgaben können abgehakt werden.');
      const id = completionId(periodKey, taskId);
      if (completionById.has(id)) {
        await store.deleteCompletion(id);
      } else {
        await store.saveCompletion({ id, periodKey, taskId, doneBy: memberId, doneAt: new Date().toISOString() });
      }
    },
    [store, memberId, completionById, canToggle],
  );

  const handOver = useCallback(
    async (periodKey: string, taskId: string, toMemberId: string, swapTaskId?: string) => {
      if (!store || !memberId) return;
      const found = findAssignment(periodKey, taskId);
      if (!found || found.a.memberId !== memberId) throw new Error('Nur eigene Aufgaben können abgegeben werden.');
      const base = { periodKey, cadence: found.ps.period.cadence, createdBy: memberId, createdAt: new Date().toISOString() };
      if (swapTaskId) {
        await store.saveOverride({ ...base, id: completionId(periodKey, taskId), taskId, memberId: toMemberId, kind: 'swap', partnerTaskId: swapTaskId });
        await store.saveOverride({ ...base, id: completionId(periodKey, swapTaskId), taskId: swapTaskId, memberId, kind: 'swap', partnerTaskId: taskId });
      } else {
        await store.saveOverride({ ...base, id: completionId(periodKey, taskId), taskId, memberId: toMemberId, kind: 'handover' });
      }
    },
    [store, memberId, findAssignment],
  );

  const revokeOverride = useCallback(
    async (periodKey: string, taskId: string) => {
      if (!store) return;
      const o = overrideById.get(completionId(periodKey, taskId));
      if (!o) return;
      await store.deleteOverride(o.id);
      if (o.kind === 'swap' && o.partnerTaskId) await store.deleteOverride(completionId(periodKey, o.partnerTaskId));
    },
    [store, overrideById],
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
    overrides: safeOverrides,
    overrideById,
    schedule,
    now,
    today,
    currentMember,
    currentWeekly,
    currentMonthly,
    login,
    logout,
    toggleCompletion,
    findAssignment,
    canToggle,
    handOver,
    revokeOverride,
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
