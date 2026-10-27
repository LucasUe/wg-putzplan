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
 * Verteilungslogik "Rotation + Übernahmen" (reine Funktionen, keine Firebase-Abhängigkeit).
 * Siehe PLAN.md Abschnitt 4.
 *
 * 1. Ideale Rotation: Zuteilung ohne Abwesenheiten (rotiert jede Aufgabe reihum).
 * 2. Ist die ideale Person für das Fenster einer Aufgabe nicht verfügbar, wird zuerst ein
 *    Tausch innerhalb der Periode versucht, sonst übernimmt die verfügbare Person mit den
 *    wenigsten bisherigen Übernahmen.
 * 3. Übernahmen werden nicht "zurückgezahlt": Sind alle da, gilt exakt die ideale Rotation.
 */

const EPS = 1e-9;

export interface TaskAssignment {
  taskId: string;
  name: string;
  weight: number;
  /** null = niemand verfügbar, Aufgabe unzugeteilt */
  memberId: string | null;
  /** Person laut idealer Rotation */
  idealMemberId: string | null;
  /** Verfügbare Personen für das Fenster dieser Aufgabe */
  eligible: string[];
  /** Weicht die Zuteilung von der idealen Rotation ab? */
  reassigned: boolean;
  /** Bei Übernahme: die abwesende ideale Person */
  takenFor: string | null;
  /** Bei Tausch: der Tauschpartner */
  swappedWith: string | null;
  /** Bei Tausch: die abwesende Person, wegen der getauscht wurde */
  swapBecause: string | null;
  /** true, wenn aus einem eingefrorenen Snapshot übernommen */
  frozen: boolean;
}

export interface PeriodSchedule {
  period: Period;
  frozen: boolean;
  assignments: TaskAssignment[];
  /** Übernommenes Gewicht je Person in dieser Periode */
  takeovers: Record<string, number>;
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
  /** Ende des berechneten Zeitraums */
  until: Date;
  /** Aktueller Zeitpunkt. Nur beendete Perioden dürfen aus Snapshots kommen. */
  now: Date;
  /** Festgelegte Zuteilungen: periodKey -> taskId -> memberId (z. B. bereits abgehakt) */
  pins?: Record<string, Record<string, string>>;
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

/** Deterministische Reihenfolge: createdAt, dann id (unabhängig von der Lade-Reihenfolge). */
function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Erklärtext für eine umverteilte Aufgabe, oder null (kein Badge). */
export function reassignBadge(a: TaskAssignment, nameOf: (id: string) => string): string | null {
  if (!a.reassigned) return null;
  if (a.takenFor) return `übernommen für ${nameOf(a.takenFor)} (abwesend)`;
  if (a.swappedWith && a.swapBecause) {
    return `getauscht mit ${nameOf(a.swappedWith)} wegen Abwesenheit von ${nameOf(a.swapBecause)}`;
  }
  return null;
}

/** Wer ist bei einem Tausch abwesend? Bei der verwaisten Aufgabe die ideale Person, sonst der neue Inhaber. */
function swapReason(memberId: string | null, idealMemberId: string | null, eligible: string[]): string | null {
  if (idealMemberId !== null && !eligible.includes(idealMemberId)) return idealMemberId;
  return memberId;
}

/**
 * Ideale Rotation einer Kadenz (ohne Abwesenheiten, Snapshots und Pins).
 * Greedy nach Saldo (Ist − gleiches Soll), Tiebreak: am längsten nicht gehabt, dann
 * am stärksten eingeschränkte Aufgabe, dann Task- und Mitgliederreihenfolge.
 */
function idealRotation(periods: Period[], tasks: Task[], members: Member[]): Map<string, Map<string, string | null>> {
  const out = new Map<string, Map<string, string | null>>();
  const saldo: Record<string, number> = {};
  for (const m of members) saldo[m.id] = 0;
  const lastDone = new Map<string, number>();
  const memberOrder = new Map(members.map((m, i) => [m.id, i]));
  const ids = members.map((m) => m.id);

  periods.forEach((period, index) => {
    const applicable = tasks.filter((t) => appliesTo(t, period));
    const taskOrder = new Map(applicable.map((t, i) => [t.id, i]));
    const chosen = new Map<string, string | null>();
    if (ids.length === 0) {
      for (const t of applicable) chosen.set(t.id, null);
      out.set(period.key, chosen);
      return;
    }
    const total = applicable.reduce((s, t) => s + t.weight, 0);
    const run: Record<string, number> = {};
    for (const id of ids) run[id] = saldo[id] - total / ids.length;
    const staleness = (taskId: string, memberId: string): number => {
      const last = lastDone.get(`${taskId}|${memberId}`);
      return last === undefined ? Number.POSITIVE_INFINITY : index - last;
    };

    let remaining = [...applicable];
    while (remaining.length > 0) {
      const topWeight = Math.max(...remaining.map((t) => t.weight));
      const pool = remaining.filter((t) => t.weight === topWeight);
      const minRun = Math.min(...ids.map((id) => run[id]));
      const lowest = ids.filter((id) => run[id] - minRun <= EPS);

      let best: { t: Task; p: string; fresh: number } | null = null;
      for (const t of pool) {
        const fresh = lowest.filter((id) => staleness(t.id, id) > 2).length;
        for (const p of lowest) {
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
      const pick = best;
      chosen.set(pick.t.id, pick.p);
      run[pick.p] += pick.t.weight;
      lastDone.set(`${pick.t.id}|${pick.p}`, index);
      remaining = remaining.filter((t) => t.id !== pick.t.id);
    }
    for (const id of ids) saldo[id] = run[id];
    out.set(period.key, chosen);
  });
  return out;
}

interface CadenceState {
  /** Kumulierte Übernahmen je Person */
  counter: Record<string, number>;
  /** Letzte Periode (Index), in der eine Person eine Aufgabe tatsächlich hatte */
  lastDone: Map<string, number>;
}

/** Tatsächliche Zuteilung einer nicht eingefrorenen Periode. */
function assignLive(
  period: Period,
  index: number,
  tasks: Task[],
  members: Member[],
  absences: Absence[],
  ideal: Map<string, string | null>,
  pins: Record<string, string>,
  state: CadenceState,
): PeriodSchedule {
  const applicable = tasks.filter((t) => appliesTo(t, period));
  const memberOrder = new Map(members.map((m, i) => [m.id, i]));
  const memberIds = new Set(members.map((m) => m.id));
  const eligibleOf = new Map<string, string[]>();
  for (const t of applicable) {
    const range = windowFor(period, t.window);
    eligibleOf.set(t.id, members.filter((m) => isAvailable(m.id, range, absences)).map((m) => m.id));
  }
  const elig = (taskId: string) => eligibleOf.get(taskId) ?? [];
  const idealOf = (taskId: string) => ideal.get(taskId) ?? null;

  // a. Start = ideale Zuteilung
  const holder = new Map<string, string | null>();
  for (const t of applicable) holder.set(t.id, idealOf(t.id));
  const swapPartner = new Map<string, string>();

  // b. Verwaiste Aufgaben: ideale Person für das Fenster nicht verfügbar
  const isOrphan = (t: Task) => {
    const a = idealOf(t.id);
    return a !== null && !elig(t.id).includes(a);
  };
  const orphans = applicable.filter(isOrphan);
  const unresolved: Task[] = [];

  // c. Tausch innerhalb der Periode
  for (const t of orphans) {
    const a = idealOf(t.id)!;
    const othersOfA = applicable.filter((x) => x.id !== t.id && holder.get(x.id) === a);
    let swapped = false;
    if (othersOfA.length === 0) {
      for (const u of applicable) {
        if (u.id === t.id || swapPartner.has(u.id) || isOrphan(u)) continue;
        const b = holder.get(u.id) ?? null;
        if (b === null || b === a) continue;
        if (elig(t.id).includes(b) && elig(u.id).includes(a)) {
          holder.set(u.id, a);
          holder.set(t.id, b);
          swapPartner.set(u.id, b);
          swapPartner.set(t.id, a);
          swapped = true;
          break;
        }
      }
    }
    if (!swapped) unresolved.push(t);
  }

  // d./e. Übernahme durch die verfügbare Person mit den wenigsten Übernahmen
  const counter = { ...state.counter };
  const load = (id: string) =>
    applicable.reduce((s, x) => s + (holder.get(x.id) === id ? x.weight : 0), 0);
  const staleness = (taskId: string, memberId: string) => {
    const last = state.lastDone.get(`${taskId}|${memberId}`);
    return last === undefined ? Number.POSITIVE_INFINITY : index - last;
  };
  for (const t of unresolved) {
    holder.set(t.id, null);
    const cands = elig(t.id);
    if (cands.length === 0) continue;
    const best = [...cands].sort((x, y) => {
      const dc = (counter[x] ?? 0) - (counter[y] ?? 0);
      if (Math.abs(dc) > EPS) return dc;
      const dl = load(x) - load(y);
      if (Math.abs(dl) > EPS) return dl;
      const sx = staleness(t.id, x);
      const sy = staleness(t.id, y);
      if (sx !== sy) return sx > sy ? -1 : 1;
      return (memberOrder.get(x) ?? 0) - (memberOrder.get(y) ?? 0);
    })[0];
    holder.set(t.id, best);
    counter[best] = (counter[best] ?? 0) + t.weight;
  }

  // f. Pins (abgehakte Aufgaben) überschreiben die Zuteilung
  for (const t of applicable) {
    const pinned = pins[t.id];
    if (pinned === undefined || !memberIds.has(pinned) || holder.get(t.id) === pinned) continue;
    const previous = holder.get(t.id) ?? null;
    const partner = swapPartner.get(t.id);
    if (partner !== undefined) {
      // Tausch aufheben: Partneraufgabe ist die, deren Tauschpartner der bisherige Inhaber war
      const partnerTask = applicable.find((x) => x.id !== t.id && holder.get(x.id) === partner && swapPartner.get(x.id) === previous);
      if (partnerTask) swapPartner.delete(partnerTask.id);
      swapPartner.delete(t.id);
    }
    holder.set(t.id, pinned);
  }

  // Ergebnis und endgültige Übernahmen dieser Periode
  const takeovers: Record<string, number> = {};
  for (const m of members) takeovers[m.id] = 0;
  const assignments: TaskAssignment[] = applicable.map((t) => {
    const memberId = holder.get(t.id) ?? null;
    const idealMemberId = idealOf(t.id);
    const eligible = elig(t.id);
    const partner = swapPartner.get(t.id) ?? null;
    const isTakeover =
      memberId !== null && partner === null && idealMemberId !== null && memberId !== idealMemberId && !eligible.includes(idealMemberId);
    if (isTakeover) takeovers[memberId] = (takeovers[memberId] ?? 0) + t.weight;
    if (memberId !== null) state.lastDone.set(`${t.id}|${memberId}`, index);
    return {
      taskId: t.id,
      name: t.name,
      weight: t.weight,
      memberId,
      idealMemberId,
      eligible,
      reassigned: memberId !== null && memberId !== idealMemberId,
      takenFor: isTakeover ? idealMemberId : null,
      swappedWith: partner,
      swapBecause: partner ? swapReason(memberId, idealMemberId, eligible) : null,
      frozen: false,
    };
  });
  for (const m of members) state.counter[m.id] = (state.counter[m.id] ?? 0) + takeovers[m.id];
  return { period, frozen: false, assignments, takeovers };
}

/** Übernimmt eine eingefrorene Periode aus dem Snapshot. */
function fromSnapshot(
  period: Period,
  index: number,
  snap: Snapshot,
  tasks: Task[],
  members: Member[],
  ideal: Map<string, string | null>,
  state: CadenceState,
): PeriodSchedule {
  const taskOrder = new Map(tasks.map((t, i) => [t.id, i]));
  const names = new Map(tasks.map((t) => [t.id, t.name]));
  const entries = Object.entries(snap.items).sort(
    (a, b) => (taskOrder.get(a[0]) ?? 1e9) - (taskOrder.get(b[0]) ?? 1e9) || (a[0] < b[0] ? -1 : 1),
  );
  const takeovers: Record<string, number> = {};
  for (const m of members) takeovers[m.id] = 0;
  const assignments: TaskAssignment[] = entries.map(([taskId, item]) => {
    const idealMemberId = ideal.get(taskId) ?? null;
    const partner = item.swapWith ?? null;
    // Fallback für alte Snapshots ohne takeover-Feld
    const isTakeover =
      item.takeover ??
      (item.memberId !== null &&
        idealMemberId !== null &&
        item.memberId !== idealMemberId &&
        !item.eligible.includes(idealMemberId));
    if (isTakeover && item.memberId) takeovers[item.memberId] = (takeovers[item.memberId] ?? 0) + item.weight;
    if (item.memberId) state.lastDone.set(`${taskId}|${item.memberId}`, index);
    return {
      taskId,
      name: names.get(taskId) ?? taskId,
      weight: item.weight,
      memberId: item.memberId,
      idealMemberId,
      eligible: item.eligible,
      reassigned: item.memberId !== null && idealMemberId !== null && item.memberId !== idealMemberId,
      takenFor: isTakeover ? idealMemberId : null,
      swappedWith: partner,
      swapBecause: partner ? swapReason(item.memberId, idealMemberId, item.eligible) : null,
      frozen: true,
    };
  });
  for (const m of members) state.counter[m.id] = (state.counter[m.id] ?? 0) + takeovers[m.id];
  return { period, frozen: true, assignments, takeovers };
}

/** Rechnet alle Perioden einer Kadenz in zeitlicher Reihenfolge. */
function runCadence(cadence: Cadence, input: ScheduleInput, tasks: Task[]): PeriodSchedule[] {
  const periods = periodsBetween(cadence, input.startDate, berlinDay(input.until));
  const ideal = idealRotation(periods, tasks, input.members);
  const snapByKey = new Map(input.snapshots.filter((s) => s.cadence === cadence).map((s) => [s.periodKey, s]));
  const today = berlinDay(input.now);
  const state: CadenceState = { counter: {}, lastDone: new Map() };
  for (const m of input.members) state.counter[m.id] = 0;

  return periods.map((period, index) => {
    const idealP = ideal.get(period.key) ?? new Map<string, string | null>();
    // Nur beendete Perioden werden eingefroren; die laufende Periode wird immer live berechnet.
    const snap = period.endDay < today ? snapByKey.get(period.key) : undefined;
    return snap
      ? fromSnapshot(period, index, snap, tasks, input.members, idealP, state)
      : assignLive(period, index, tasks, input.members, input.absences, idealP, input.pins?.[period.key] ?? {}, state);
  });
}

/**
 * Berechnet den Plan. Beendete Perioden mit Snapshot werden übernommen,
 * alle übrigen live aus idealer Rotation, Abwesenheiten und Pins berechnet.
 */
export function computeSchedule(input: ScheduleInput): Schedule {
  const tasks = sortTasks(input.tasks);
  return {
    weekly: runCadence('weekly', input, tasks),
    monthly: runCadence('monthly', input, tasks),
  };
}

/** Eingefrorener Snapshot aus einer berechneten Periode. */
export function buildSnapshot(ps: PeriodSchedule, savedAt: string): Snapshot {
  const items: Snapshot['items'] = {};
  for (const a of ps.assignments) {
    items[a.taskId] = {
      memberId: a.memberId,
      weight: a.weight,
      eligible: [...a.eligible],
      takeover: a.takenFor !== null,
      swapWith: a.swappedWith,
    };
  }
  return { periodKey: ps.period.key, cadence: ps.period.cadence, items, savedAt };
}

export interface Balance {
  memberId: string;
  /** Summe der übernommenen Dienste (Gewicht) */
  takeovers: number;
}

/** Summiert die Übernahmen je Person über die übergebenen Perioden. */
export function getBalances(periods: PeriodSchedule[], members: Member[]): Balance[] {
  return members.map((m) => ({
    memberId: m.id,
    takeovers: periods.reduce((s, p) => s + (p.takeovers[m.id] ?? 0), 0),
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
