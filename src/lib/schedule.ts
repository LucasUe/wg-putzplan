import {
  addDays,
  berlinDay,
  countDays,
  isWindowValidFor,
  periodAt,
  periodOf,
  periodsBetween,
  windowFor,
  type Cadence,
  type DayRange,
  type Period,
} from './periods';
import type { Absence, Member, Snapshot, Task } from './types';

/**
 * Verteilungslogik (reine Funktionen, keine Firebase-Abhängigkeit).
 * Siehe PLAN.md Abschnitt 4 sowie Abschnitt 11 (Entscheidungen).
 */

const EPS = 1e-9;

export interface TaskAssignment {
  taskId: string;
  name: string;
  weight: number;
  /** null = niemand verfügbar, Aufgabe unzugeteilt */
  memberId: string | null;
  /** Verfügbare Personen für das Fenster dieser Aufgabe */
  eligible: string[];
  /** Weicht die Zuteilung von der Rotation ohne Abwesenheiten ab? */
  reassigned: boolean;
  /** Personen, die für das Fenster dieser Aufgabe abwesend sind (nur bei Umverteilung relevant) */
  absentMemberIds: string[];
  /** true, wenn aus einem eingefrorenen Snapshot übernommen */
  frozen: boolean;
}

export interface PeriodSchedule {
  period: Period;
  frozen: boolean;
  assignments: TaskAssignment[];
  /** Soll je Person (nur verfügbare Personen bekommen Soll) */
  soll: Record<string, number>;
  /** Ist je Person (Summe der Gewichte zugeteilter Aufgaben) */
  ist: Record<string, number>;
}

export interface Schedule {
  weekly: PeriodSchedule[];
  monthly: PeriodSchedule[];
}

export interface ScheduleInput {
  members: Member[];
  tasks: Task[];
  absences: Absence[];
  startDate: string;
  snapshots: Snapshot[];
  until: Date;
}

/**
 * Ist eine Person in einem Tagesbereich verfügbar?
 * Nicht verfügbar, wenn Abwesenheiten mehr als 50 % der Tage des Bereichs abdecken.
 */
export function isAvailable(memberId: string, window: DayRange, absences: Absence[]): boolean {
  const total = countDays(window);
  const absent = new Set<string>();
  for (const a of absences) {
    if (a.memberId !== memberId) continue;
    const from = a.from > window.startDay ? a.from : window.startDay;
    const to = a.to < window.endDay ? a.to : window.endDay;
    for (let d = from; d <= to; d = addDays(d, 1)) absent.add(d);
  }
  return absent.size * 2 <= total;
}

/** Aufgabe zählt für eine Periode, wenn sie aktiv ist und ab ihrer eigenen Periode existiert. */
function appliesTo(task: Task, period: Period): boolean {
  if (!task.active || task.cadence !== period.cadence) return false;
  if (!isWindowValidFor(task.cadence, task.window)) return false;
  const createdPeriod = periodOf(task.cadence, berlinDay(new Date(task.createdAt)));
  return createdPeriod.startDay <= period.startDay;
}

interface Row {
  period: Period;
  frozen: boolean;
  assignments: TaskAssignment[];
  soll: Record<string, number>;
  ist: Record<string, number>;
}

/** Rechnet die Zuteilung für eine Periode, die noch nicht eingefroren ist. */
function assignLive(
  period: Period,
  tasks: Task[],
  members: Member[],
  absences: Absence[],
  saldo: Record<string, number>,
  lastDone: Map<string, number>,
  index: number,
): Row {
  const applicable = tasks.filter((t) => appliesTo(t, period));
  const eligibleOf = new Map<string, string[]>();
  for (const t of applicable) {
    const range = windowFor(period, t.window);
    eligibleOf.set(
      t.id,
      members.filter((m) => isAvailable(m.id, range, absences)).map((m) => m.id),
    );
  }

  // Soll: Gewicht je Aufgabe gleichmäßig auf die verfügbaren Personen dieser Aufgabe verteilt.
  const soll: Record<string, number> = {};
  const ist: Record<string, number> = {};
  for (const m of members) {
    soll[m.id] = 0;
    ist[m.id] = 0;
  }
  for (const t of applicable) {
    const elig = eligibleOf.get(t.id) ?? [];
    for (const id of elig) soll[id] += t.weight / elig.length;
  }

  // Greedy: schwerste Aufgaben zuerst, an die verfügbare Person mit dem niedrigsten laufenden Saldo.
  // Bei Gleichstand: wer diese Aufgabe am längsten nicht hatte; danach die am stärksten
  // eingeschränkte Aufgabe (wenige Personen, die sie lange nicht hatten), damit die Rotation aufgeht.
  const run: Record<string, number> = {};
  for (const m of members) run[m.id] = (saldo[m.id] ?? 0) - soll[m.id];
  const staleness = (taskId: string, memberId: string): number => {
    const last = lastDone.get(`${taskId}|${memberId}`);
    return last === undefined ? Number.POSITIVE_INFINITY : index - last;
  };
  const taskOrder = new Map(applicable.map((t, i) => [t.id, i]));
  const memberOrder = new Map(members.map((m, i) => [m.id, i]));

  const chosen = new Map<string, string | null>();
  let remaining = applicable.filter((t) => (eligibleOf.get(t.id) ?? []).length > 0);
  for (const t of applicable) {
    if ((eligibleOf.get(t.id) ?? []).length === 0) chosen.set(t.id, null);
  }

  while (remaining.length > 0) {
    const topWeight = Math.max(...remaining.map((t) => t.weight));
    const pool = remaining.filter((t) => t.weight === topWeight);
    // Nur Personen mit dem niedrigsten laufenden Saldo kommen in Frage.
    const allCandidates = new Set<string>();
    for (const t of pool) for (const id of eligibleOf.get(t.id) ?? []) allCandidates.add(id);
    const minRun = Math.min(...[...allCandidates].map((id) => run[id]));
    const lowest = new Set([...allCandidates].filter((id) => run[id] - minRun <= EPS));

    let best: { t: Task; p: string; fresh: number } | null = null;
    for (const t of pool) {
      const elig = (eligibleOf.get(t.id) ?? []).filter((id) => lowest.has(id));
      // Anzahl Personen mit niedrigstem Saldo, die diese Aufgabe nicht in den letzten zwei Perioden hatten
      const fresh = elig.filter((id) => staleness(t.id, id) > 2).length;
      for (const p of elig) {
        if (best === null) {
          best = { t, p, fresh };
          continue;
        }
        const sp = staleness(t.id, p);
        const sb = staleness(best.t.id, best.p);
        let better = false;
        if (sp > sb) better = true;
        else if (sp === sb) {
          if (fresh < best.fresh) better = true;
          else if (fresh === best.fresh) {
            const to = taskOrder.get(t.id) ?? 0;
            const bo = taskOrder.get(best.t.id) ?? 0;
            if (to < bo || (to === bo && (memberOrder.get(p) ?? 0) < (memberOrder.get(best.p) ?? 0))) better = true;
          }
        }
        if (better) best = { t, p, fresh };
      }
    }
    if (best === null) break;
    chosen.set(best.t.id, best.p);
    run[best.p] += best.t.weight;
    ist[best.p] += best.t.weight;
    lastDone.set(`${best.t.id}|${best.p}`, index);
    remaining = remaining.filter((t) => t.id !== best!.t.id);
  }

  const assignments: TaskAssignment[] = applicable.map((t) => ({
    taskId: t.id,
    name: t.name,
    weight: t.weight,
    memberId: chosen.get(t.id) ?? null,
    eligible: eligibleOf.get(t.id) ?? [],
    reassigned: false,
    absentMemberIds: [],
    frozen: false,
  }));
  return { period, frozen: false, assignments, soll, ist };
}

/** Übernimmt eine eingefrorene Periode aus dem Snapshot. */
function fromSnapshot(
  period: Period,
  snap: Snapshot,
  tasks: Task[],
  members: Member[],
  lastDone: Map<string, number>,
  index: number,
): Row {
  const taskOrder = new Map(tasks.map((t, i) => [t.id, i]));
  const names = new Map(tasks.map((t) => [t.id, t.name]));
  const entries = Object.entries(snap.items).sort(
    (a, b) => (taskOrder.get(a[0]) ?? 1e9) - (taskOrder.get(b[0]) ?? 1e9),
  );
  const soll: Record<string, number> = {};
  const ist: Record<string, number> = {};
  for (const m of members) {
    soll[m.id] = 0;
    ist[m.id] = 0;
  }
  const assignments: TaskAssignment[] = entries.map(([taskId, item]) => {
    for (const id of item.eligible) soll[id] = (soll[id] ?? 0) + item.weight / item.eligible.length;
    if (item.memberId) {
      ist[item.memberId] = (ist[item.memberId] ?? 0) + item.weight;
      lastDone.set(`${taskId}|${item.memberId}`, index);
    }
    return {
      taskId,
      name: names.get(taskId) ?? taskId,
      weight: item.weight,
      memberId: item.memberId,
      eligible: item.eligible,
      reassigned: false,
      absentMemberIds: [],
      frozen: true,
    };
  });
  return { period, frozen: true, assignments, soll, ist };
}

/** Rechnet alle Perioden einer Kadenz in zeitlicher Reihenfolge. */
function runCadence(cadence: Cadence, input: ScheduleInput): PeriodSchedule[] {
  const untilDay = berlinDay(input.until);
  const periods = periodsBetween(cadence, input.startDate, untilDay);
  const snapByKey = new Map(input.snapshots.filter((s) => s.cadence === cadence).map((s) => [s.periodKey, s]));
  const saldo: Record<string, number> = {};
  for (const m of input.members) saldo[m.id] = 0;
  const lastDone = new Map<string, number>();
  const out: PeriodSchedule[] = [];

  periods.forEach((period, index) => {
    const snap = snapByKey.get(period.key);
    const row = snap
      ? fromSnapshot(period, snap, input.tasks, input.members, lastDone, index)
      : assignLive(period, input.tasks, input.members, input.absences, saldo, lastDone, index);
    for (const m of input.members) {
      saldo[m.id] = (saldo[m.id] ?? 0) + row.ist[m.id] - row.soll[m.id];
    }
    out.push(row);
  });
  return out.map((r) => ({ period: r.period, frozen: r.frozen, assignments: r.assignments, soll: r.soll, ist: r.ist }));
}

/**
 * Berechnet den Plan. Vergangene/begonnene Perioden mit Snapshot werden übernommen,
 * alle übrigen live aus Startdatum, Aufgaben und Abwesenheiten berechnet.
 * Zusätzlich wird markiert, wo eine Aufgabe gegenüber der Rotation ohne Abwesenheiten umverteilt wurde.
 */
export function computeSchedule(input: ScheduleInput): Schedule {
  const actual = {
    weekly: runCadence('weekly', input),
    monthly: runCadence('monthly', input),
  };
  // Referenz: gleiche Rotation ohne Abwesenheiten und ohne Snapshots.
  const ideal = {
    weekly: runCadence('weekly', { ...input, absences: [], snapshots: [] }),
    monthly: runCadence('monthly', { ...input, absences: [], snapshots: [] }),
  };
  const flag = (cadence: Cadence, ps: PeriodSchedule[]): PeriodSchedule[] => {
    const members = input.members;
    const idealByKey = new Map(ideal[cadence].map((p) => [p.period.key, p]));
    return ps.map((p) => {
      const ref = idealByKey.get(p.period.key);
      const refAssign = new Map(ref?.assignments.map((a) => [a.taskId, a]) ?? []);
      const assignments = p.assignments.map((a) => {
        const r = refAssign.get(a.taskId);
        const idealMember = r?.memberId ?? null;
        if (idealMember === null || idealMember === a.memberId) return a;
        const absentMemberIds = members.map((m) => m.id).filter((id) => !a.eligible.includes(id));
        return { ...a, reassigned: true, absentMemberIds };
      });
      return { ...p, assignments };
    });
  };
  return { weekly: flag('weekly', actual.weekly), monthly: flag('monthly', actual.monthly) };
}

/** Eingefrorener Snapshot aus einer berechneten Periode. */
export function buildSnapshot(ps: PeriodSchedule, savedAt: string): Snapshot {
  const items: Snapshot['items'] = {};
  for (const a of ps.assignments) {
    items[a.taskId] = { memberId: a.memberId, weight: a.weight, eligible: [...a.eligible] };
  }
  return { periodKey: ps.period.key, cadence: ps.period.cadence, items, savedAt };
}

export interface Balance {
  memberId: string;
  soll: number;
  ist: number;
  saldo: number;
}

/** Summiert Soll/Ist über die übergebenen Perioden. Saldo = Ist - Soll. */
export function getBalances(periods: PeriodSchedule[], members: Member[]): Balance[] {
  const soll: Record<string, number> = {};
  const ist: Record<string, number> = {};
  for (const m of members) {
    soll[m.id] = 0;
    ist[m.id] = 0;
  }
  for (const p of periods) {
    for (const m of members) {
      soll[m.id] += p.soll[m.id] ?? 0;
      ist[m.id] += p.ist[m.id] ?? 0;
    }
  }
  return members.map((m) => ({
    memberId: m.id,
    soll: soll[m.id],
    ist: ist[m.id],
    saldo: ist[m.id] - soll[m.id],
  }));
}

/** Perioden, die bis zum angegebenen Zeitpunkt begonnen haben. */
export function startedPeriods(ps: PeriodSchedule[], now: Date): PeriodSchedule[] {
  const today = berlinDay(now);
  return ps.filter((p) => p.period.startDay <= today);
}

/** Aktuelle Periode einer Kadenz zum Zeitpunkt now. */
export function currentPeriod(cadence: Cadence, now: Date): Period {
  return periodAt(cadence, now);
}
