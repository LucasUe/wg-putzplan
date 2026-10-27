import { formatInTimeZone } from 'date-fns-tz';
import {
  addDays,
  berlinDay,
  formatDayRangeShort,
  monthPeriod,
  periodAt,
  TZ,
  weekdayIndex,
  windowFor,
  type Period,
} from '../src/lib/periods';
import { buildSnapshot, computeSchedule, type PeriodSchedule, type Schedule } from '../src/lib/schedule';
import type { Absence, Completion, Member, Snapshot, Task } from '../src/lib/types';

/**
 * Reine Erinnerungslogik (PLAN.md Abschnitt 6), ohne Firebase und ohne Netzwerk.
 * Zeitzone Europe/Berlin. Der Cron läuft stündlich; gesendet wird, wenn die Berliner Stunde passt.
 */

export interface ReminderMessage {
  /** Dedup-Schlüssel, ohne "/" (Firestore-Dokument-ID) */
  key: string;
  memberId: string;
  title: string;
  body: string;
  tag: string;
  url: string;
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
  /** Neue Snapshots für begonnene Perioden ohne Snapshot */
  newSnapshots: Snapshot[];
  /** Aktualisierte Zuteilungs-Stände (für "Neu zugeteilt") */
  assignmentUpdates: Record<string, Record<string, string | null>>;
  schedule: Schedule;
}

const HORIZON_DAYS = 40;
const DAY_MS = 86_400_000;

function berlinHour(now: Date): number {
  return Number(formatInTimeZone(now, TZ, 'H'));
}

function lastDayOfMonth(day: string): string {
  return monthPeriod(day).endDay;
}

export function planReminders(input: ReminderInput): ReminderResult {
  const { now, members, tasks } = input;
  const today = berlinDay(now);
  const weekday = weekdayIndex(today);
  const hour = berlinHour(now);
  const dom = Number(today.slice(8, 10));

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

  const mine = (ps: PeriodSchedule | undefined, memberId: string, filter?: (taskId: string) => boolean) =>
    (ps?.assignments ?? []).filter(
      (a) => a.memberId === memberId && taskById.has(a.taskId) && (!filter || filter(a.taskId)),
    );
  const isOpen = (period: Period, taskId: string) => !completionIds.has(`${period.key}_${taskId}`);
  const names = (list: { taskId: string }[]) => list.map((a) => taskById.get(a.taskId)?.name ?? a.taskId).join(', ');
  const weekendOnly = (taskId: string) => taskById.get(taskId)?.window === 'weekend';

  for (const m of members) {
    if (wk && weekday === 0 && hour === 9) {
      const list = mine(wk, m.id);
      if (list.length)
        push({
          key: `wk-mon-${wk.period.key}-${m.id}`,
          memberId: m.id,
          title: 'Neue Woche',
          body: `Diese Woche bist du dran mit: ${names(list)} (${formatDayRangeShort(wk.period)})`,
          tag: 'wochenstart',
          url: './',
        });
    }
    if (wk && weekday === 4 && hour === 10) {
      const list = mine(wk, m.id, weekendOnly);
      if (list.length)
        push({
          key: `wk-fri-${wk.period.key}-${m.id}`,
          memberId: m.id,
          title: 'Wochenende',
          body: `Dieses Wochenende: ${names(list)}`,
          tag: 'wochenende',
          url: './',
        });
    }
    if (wk && weekday === 6 && hour === 18) {
      const list = mine(wk, m.id).filter((a) => isOpen(wk.period, a.taskId));
      if (list.length)
        push({
          key: `wk-sun-${wk.period.key}-${m.id}`,
          memberId: m.id,
          title: 'Noch offen',
          body: `Diese Woche noch offen: ${names(list)}`,
          tag: 'wochen-offen',
          url: './',
        });
    }
    if (mo && dom === 1 && hour === 10) {
      const list = mine(mo, m.id);
      if (list.length)
        push({
          key: `mo-start-${mo.period.key}-${m.id}`,
          memberId: m.id,
          title: 'Neuer Monat',
          body: `Diesen Monat bist du dran mit: ${names(list)}`,
          tag: 'monatsstart',
          url: './',
        });
    }
    if (mo && dom === Number(lastDayOfMonth(today).slice(8, 10)) - 2 && hour === 10) {
      const list = mine(mo, m.id).filter((a) => isOpen(mo.period, a.taskId));
      if (list.length)
        push({
          key: `mo-end-${mo.period.key}-${m.id}`,
          memberId: m.id,
          title: 'Monatsende in 3 Tagen',
          body: `Noch offen: ${names(list)}`,
          tag: 'monatsende',
          url: './',
        });
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
          url: './',
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
