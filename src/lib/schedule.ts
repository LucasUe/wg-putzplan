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
  /** Personen, die in dieser Periode für mindestens eine Aufgabe nicht verfügbar sind */
  absentMemberIds: string[];
  /** Wenn umverteilt und die ideale Person abwesend ist: deren ID */
  takenFor: string | null;
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

interface Row {
  period: Period;
  frozen: boolean;
  assignments: TaskAssignment[];
  soll: Record<string, number>;
  ist: Record<string, number>;
}

/**
 * Wasserfüllung für eine Aufgabe: verteilt das Gewicht so auf die Basislasten, dass das
 * Ergebnis (Basis + Anteil) auf einem gemeinsamen Niveau L liegt, wo es Anteile gibt.
 */
function waterfill(base: number[], weight: number): number[] {
  const order = base.map((_, i) => i).sort((a, b) => base[a] - base[b]);
  const n = base.length;
  let prefix = 0;
  let level = 0;
  for (let k = 1; k <= n; k++) {
    prefix += base[order[k - 1]];
    const candidate = (weight + prefix) / k;
    if (k === n || candidate <= base[order[k]]) {
      level = candidate;
      break;
    }
  }
  return base.map((b) => Math.max(0, level - b));
}

/**
 * Max-min-faire Soll-Verteilung: Jede Aufgabe verteilt ihr Gewicht nur auf ihre verfügbaren
 * Personen. Iterativ (Koordinatenabstieg) wird je Aufgabe neu gewässert, bis sich nichts mehr ändert.
 */
export function fairShares(items: { weight: number; eligible: string[] }[], memberIds: string[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const id of memberIds) total[id] = 0;
  const shares: number[][] = items.map((it) =>
    it.eligible.map(() => (it.eligible.length ? it.weight / it.eligible.length : 0)),
  );
  items.forEach((it, i) => it.eligible.forEach((id, j) => (total[id] = (total[id] ?? 0) + shares[i][j])));
  for (let iter = 0; iter < 200; iter++) {
    let maxDelta = 0;
    items.forEach((it, i) => {
      if (it.eligible.length === 0) return;
      const base = it.eligible.map((id, j) => (total[id] ?? 0) - shares[i][j]);
      const next = waterfill(base, it.weight);
      it.eligible.forEach((id, j) => {
        const d = next[j] - shares[i][j];
        maxDelta = Math.max(maxDelta, Math.abs(d));
        total[id] = (total[id] ?? 0) + d;
        shares[i][j] = next[j];
      });
    });
    if (maxDelta < 1e-9) break;
  }
  return total;
}

/** Erklärtext für eine umverteilte Aufgabe, oder null (kein Badge). */
export function reassignBadge(a: TaskAssignment, nameOf: (id: string) => string): string | null {
  if (!a.reassigned) return null;
  if (a.takenFor) return `übernommen für ${nameOf(a.takenFor)} (abwesend)`;
  if (a.absentMemberIds.length) return `getauscht wegen Abwesenheit von ${a.absentMemberIds.map(nameOf).join(' und ')}`;
  return null;
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
  pins: Record<string, string>,
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
  const sollMap = fairShares(
    applicable.map((t) => ({ weight: t.weight, eligible: eligibleOf.get(t.id) ?? [] })),
    members.map((m) => m.id),
  );
  for (const m of members) soll[m.id] = sollMap[m.id] ?? 0;

  const run: Record<string, number> = {};
  for (const m of members) run[m.id] = (saldo[m.id] ?? 0) - soll[m.id];
  const staleness = (taskId: string, memberId: string): number => {
    const last = lastDone.get(`${taskId}|${memberId}`);
    return last === undefined ? Number.POSITIVE_INFINITY : index - last;
  };
  const taskOrder = new Map(applicable.map((t, i) => [t.id, i]));
  const memberOrder = new Map(members.map((m, i) => [m.id, i]));
  const memberIds = new Set(members.map((m) => m.id));

  const chosen = new Map<string, string | null>();

  // Festgelegte Aufgaben (z. B. bereits abgehakt) zuerst; sie zählen in Ist und laufendem Saldo.
  for (const t of applicable) {
    const pinned = pins[t.id];
    if (pinned === undefined || !memberIds.has(pinned)) continue;
    chosen.set(t.id, pinned);
    run[pinned] += t.weight;
    ist[pinned] += t.weight;
    lastDone.set(`${t.id}|${pinned}`, index);
  }

  // Greedy: schwerste Aufgaben zuerst, an die verfügbare Person mit dem niedrigsten laufenden Saldo.
  // Bei Gleichstand: wer diese Aufgabe am längsten nicht hatte; danach die am stärksten
  // eingeschränkte Aufgabe (wenige Personen, die sie lange nicht hatten), damit die Rotation aufgeht.
  for (const t of applicable) {
    if (!chosen.has(t.id) && (eligibleOf.get(t.id) ?? []).length === 0) chosen.set(t.id, null);
  }
  let remaining = applicable.filter((t) => !chosen.has(t.id));

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
    takenFor: null,
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
  const sollMap = fairShares(
    entries.map(([, item]) => ({ weight: item.weight, eligible: item.eligible })),
    members.map((m) => m.id),
  );
  for (const m of members) soll[m.id] = sollMap[m.id] ?? 0;
  const assignments: TaskAssignment[] = entries.map(([taskId, item]) => {
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
      takenFor: null,
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
  const today = berlinDay(input.now);
  const saldo: Record<string, number> = {};
  for (const m of input.members) saldo[m.id] = 0;
  const lastDone = new Map<string, number>();
  const out: PeriodSchedule[] = [];

  periods.forEach((period, index) => {
    // Nur beendete Perioden werden eingefroren; die laufende Periode wird immer live berechnet.
    const snap = period.endDay < today ? snapByKey.get(period.key) : undefined;
    const row = snap
      ? fromSnapshot(period, snap, input.tasks, input.members, lastDone, index)
      : assignLive(period, input.tasks, input.members, input.absences, saldo, lastDone, index, input.pins?.[period.key] ?? {});
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
    const memberIds = input.members.map((m) => m.id);
    const idealByKey = new Map(ideal[cadence].map((p) => [p.period.key, p]));
    return ps.map((p) => {
      const ref = idealByKey.get(p.period.key);
      const refAssign = new Map(ref?.assignments.map((a) => [a.taskId, a]) ?? []);
      // Personen, die in dieser Periode für mindestens eine Aufgabe nicht verfügbar sind
      const absentMemberIds = memberIds.filter((id) => p.assignments.some((a) => !a.eligible.includes(id)));
      const assignments = p.assignments.map((a) => {
        const idealMember = refAssign.get(a.taskId)?.memberId ?? null;
        if (idealMember === null || idealMember === a.memberId) return { ...a, absentMemberIds };
        const takenFor = a.eligible.includes(idealMember) ? null : idealMember;
        return { ...a, reassigned: true, absentMemberIds, takenFor };
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
