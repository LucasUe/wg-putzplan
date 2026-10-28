import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  addDays,
  berlinDay,
  formatDayRangeShort,
  formatDayTime,
  periodAt,
  rangeEnd,
  TZ,
  windowFor,
  type DayRange,
  type Period,
} from '../src/lib/periods';
import { buildSnapshot, computeSchedule, type PeriodSchedule, type Schedule } from '../src/lib/schedule';
import type { Absence, Completion, Member, Snapshot, Task } from '../src/lib/types';

/**
 * Reine Erinnerungslogik (PLAN.md Abschnitt 6), ohne Firebase und ohne Netzwerk.
 * Zeitzone Europe/Berlin. Ein Termin ist fällig, wenn er in (now − 3 h, now] liegt und
 * sein Dedup-Schlüssel noch nicht versendet wurde. So schaden verspätete GitHub-Crons nicht.
 */

export interface ReminderMessage {
  /** Dedup-Schlüssel, ohne "/" (Firestore-Dokument-ID) */
  key: string;
  memberId: string;
  title: string;
  body: string;
  tag: string;
  url: string;
  periodKey: string | null;
  taskId: string | null;
  taskName: string | null;
  /** Darf direkt aus der Benachrichtigung abgehakt werden? */
  canComplete: boolean;
}

export interface ReminderInput {
  now: Date;
  members: Member[];
  tasks: Task[];
  absences: Absence[];
  startDate: string;
  snapshots: Snapshot[];
  completions: Completion[];
  /** Bereits versendete Dedup-Schlüssel */
  sentKeys: Set<string>;
  /** Zuletzt gemeldete Zuteilung je Periode: periodKey -> taskId -> memberId */
  lastAssignments: Record<string, Record<string, string | null>>;
}

export interface ReminderResult {
  messages: ReminderMessage[];
  /** Neue Snapshots für beendete Perioden ohne Snapshot */
  newSnapshots: Snapshot[];
  /** Aktualisierte Zuteilungs-Stände (für "Neu zugeteilt") */
  assignmentUpdates: Record<string, Record<string, string | null>>;
  schedule: Schedule;
}

const HORIZON_DAYS = 40;
const DAY_MS = 86_400_000;
/** Wie lange ein verpasster Termin noch nachgeholt wird */
export const CATCH_UP_MS = 3 * 3_600_000;

interface Slot {
  rule: string;
  at: Date;
}

/** Zeitpunkt "Tag HH:00" in Berlin. */
function atBerlin(day: string, hour: number): Date {
  return fromZonedTime(`${day}T${String(hour).padStart(2, '0')}:00:00`, TZ);
}

/** Erinnerungstermine einer Aufgabe in ihrer Periode. */
function slotsFor(task: Task, period: Period, range: DayRange): Slot[] {
  if (task.window === 'weekend') {
    // Freitag, Samstag, Sonntag 17:00 sowie Sonntag 20:00
    return [
      { rule: 'we', at: atBerlin(range.startDay, 17) },
      { rule: 'we', at: atBerlin(addDays(range.startDay, 1), 17) },
      { rule: 'we', at: atBerlin(addDays(range.startDay, 2), 17) },
      { rule: 'we', at: atBerlin(addDays(range.startDay, 2), 20) },
    ];
  }
  if (task.window === 'fullWeek') {
    // Montag, Mittwoch, Freitag, Sonntag 17:00
    return [0, 2, 4, 6].map((d) => ({ rule: 'wk', at: atBerlin(addDays(period.startDay, d), 17) }));
  }
  // Monat: 1. des Monats 10:00 und 3 Tage vor Monatsende 10:00
  return [
    { rule: 'mo-start', at: atBerlin(period.startDay, 10) },
    { rule: 'mo-end', at: atBerlin(addDays(period.endDay, -2), 10) },
  ];
}

export function planReminders(input: ReminderInput): ReminderResult {
  const { now, members, tasks } = input;
  const today = berlinDay(now);
  const hour = Number(formatInTimeZone(now, TZ, 'H'));

  // Erledigte Aufgaben: ID-Menge für "offen" und Pins (bleiben bei der abhakenden Person).
  const completionIds = new Set(input.completions.map((c) => c.id));
  const pins: Record<string, Record<string, string>> = {};
  for (const c of input.completions) (pins[c.periodKey] ??= {})[c.taskId] = c.doneBy;

  const schedule = computeSchedule({
    members,
    tasks,
    absences: input.absences,
    startDate: input.startDate,
    snapshots: input.snapshots,
    until: new Date(now.getTime() + HORIZON_DAYS * DAY_MS),
    now,
    pins,
  });

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const curWeek = periodAt('weekly', now);
  const curMonth = periodAt('monthly', now);
  const wk = schedule.weekly.find((p) => p.period.key === curWeek.key);
  const mo = schedule.monthly.find((p) => p.period.key === curMonth.key);

  const messages: ReminderMessage[] = [];
  const seen = new Set<string>();
  const push = (m: ReminderMessage) => {
    if (input.sentKeys.has(m.key) || seen.has(m.key)) return;
    seen.add(m.key);
    messages.push(m);
  };

  // Termin-Erinnerungen für die laufenden Perioden
  for (const ps of [wk, mo]) {
    if (!ps) continue;
    for (const a of ps.assignments) {
      const t = taskById.get(a.taskId);
      if (!t || !a.memberId) continue;
      if (completionIds.has(`${ps.period.key}_${t.id}`)) continue; // schon abgehakt
      const range = windowFor(ps.period, t.window);
      const end = rangeEnd(range);
      const endText = formatDayTime(new Date(end.getTime() - 60_000));
      for (const slot of slotsFor(t, ps.period, range)) {
        const at = slot.at.getTime();
        if (at > now.getTime() || at <= now.getTime() - CATCH_UP_MS) continue;
        if (at >= end.getTime()) continue; // Fenster schon vorbei
        let body: string;
        if (slot.rule === 'wk') {
          body = `${t.icon} Diese Woche bist du mit ${t.name} dran (${formatDayRangeShort(range)} 23:59)`;
        } else if (slot.rule === 'mo-start') {
          body = `${t.icon} Diesen Monat bist du mit ${t.name} dran – bis ${endText}`;
        } else {
          body = `${t.icon} ${t.name} ist noch offen – bis ${endText}`;
        }
        push({
          key: `${slot.rule}-${ps.period.key}-${t.id}-${a.memberId}-${formatInTimeZone(slot.at, TZ, "yyyy-MM-dd'T'HH")}`,
          memberId: a.memberId,
          title: 'WG-Putzplan',
          body,
          tag: `${ps.period.key}-${t.id}`,
          url: './#/overview',
          periodKey: ps.period.key,
          taskId: t.id,
          taskName: t.name,
          canComplete: t.window !== 'fullWeek',
        });
      }
    }
  }

  // Umverteilungen: Zuteilung gegen den zuletzt gemeldeten Stand prüfen (nur tagsüber).
  const assignmentUpdates: Record<string, Record<string, string | null>> = {};
  const watched: { ps: PeriodSchedule | undefined }[] = [
    { ps: wk },
    { ps: schedule.weekly.find((p) => p.period.startDay === addDays(curWeek.startDay, 7)) },
    { ps: mo },
  ];
  for (const { ps } of watched) {
    if (!ps) continue;
    const current: Record<string, string | null> = {};
    for (const a of ps.assignments) current[a.taskId] = a.memberId;
    const prev = input.lastAssignments[ps.period.key];
    if (prev && hour >= 8 && hour <= 22) {
      for (const a of ps.assignments) {
        if (!a.memberId || prev[a.taskId] === a.memberId || prev[a.taskId] === undefined) continue;
        const t = taskById.get(a.taskId);
        if (!t) continue;
        const range = formatDayRangeShort(windowFor(ps.period, t.window));
        push({
          key: `reassign-${ps.period.key}-${a.taskId}-${a.memberId}`,
          memberId: a.memberId,
          title: 'Neu zugeteilt',
          body: `Neu zugeteilt: ${t.name} (${range}), vorher ${memberName.get(prev[a.taskId] ?? '') ?? 'niemand'}`,
          tag: `neu-${ps.period.key}`,
          url: './#/overview',
          periodKey: ps.period.key,
          taskId: t.id,
          taskName: t.name,
          canComplete: false,
        });
      }
    }
    assignmentUpdates[ps.period.key] = current;
  }

  // Beendete Perioden ohne Snapshot einfrieren (wie im Client). Laufende Perioden bleiben live.
  const newSnapshots: Snapshot[] = [];
  const savedAt = now.toISOString();
  const haveSnap = new Set(input.snapshots.map((s) => `${s.cadence}:${s.periodKey}`));
  for (const ps of [...schedule.weekly, ...schedule.monthly]) {
    if (ps.frozen || ps.period.endDay >= today) continue;
    if (haveSnap.has(`${ps.period.cadence}:${ps.period.key}`)) continue;
    newSnapshots.push(buildSnapshot(ps, savedAt));
  }

  return { messages, newSnapshots, assignmentUpdates, schedule };
}
