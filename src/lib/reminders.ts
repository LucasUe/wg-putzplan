import { addDays, type Period, type TaskWindow } from './periods';
import type { ReminderSlot, Task, TaskReminders } from './types';

/** Standard-Erinnerungen je Zeitfenster (entspricht dem bisherigen festen Verhalten). */
export function defaultRemindersFor(window: TaskWindow): TaskReminders {
  if (window === 'weekend') {
    return {
      enabled: true,
      withButtons: true,
      slots: [
        { day: 5, time: '17:00' },
        { day: 6, time: '17:00' },
        { day: 7, time: '17:00' },
        { day: 7, time: '20:00' },
      ],
    };
  }
  if (window === 'fullWeek') {
    return {
      enabled: true,
      withButtons: false,
      slots: [1, 3, 5, 7].map((day) => ({ day, time: '17:00' })),
    };
  }
  return {
    enabled: true,
    withButtons: true,
    slots: [
      { day: 1, time: '10:00' },
      { day: -2, time: '10:00' },
    ],
  };
}

export function defaultReminders(task: Pick<Task, 'window'>): TaskReminders {
  return defaultRemindersFor(task.window);
}

/** Wirksame Erinnerungen einer Aufgabe. */
export function remindersOf(task: Pick<Task, 'window' | 'reminders'>): TaskReminders {
  return task.reminders ?? defaultReminders(task);
}

export function sameReminders(a: TaskReminders, b: TaskReminders): boolean {
  return (
    a.enabled === b.enabled &&
    a.withButtons === b.withButtons &&
    a.slots.length === b.slots.length &&
    a.slots.every((s, i) => s.day === b.slots[i].day && s.time === b.slots[i].time)
  );
}

/** Erlaubte Tage je Fenster (für Auswahl und Validierung). */
export function allowedDays(window: TaskWindow): number[] {
  if (window === 'weekend') return [5, 6, 7];
  if (window === 'fullWeek') return [1, 2, 3, 4, 5, 6, 7];
  const days: number[] = [];
  for (let d = 1; d <= 28; d++) days.push(d);
  for (let d = 0; d >= -6; d--) days.push(d);
  return days;
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const FROM_END = ['letzter Tag', 'vorletzter Tag', 'drittletzter Tag'];

export function dayLabel(window: TaskWindow, day: number): string {
  if (window !== 'fullMonth') return WEEKDAYS[day - 1] ?? String(day);
  if (day >= 1) return `${day}.`;
  const n = -day; // 0 = letzter
  return FROM_END[n] ?? `${n + 1}. letzter Tag`;
}

/** Kalendertag eines Termins in der Periode, oder null wenn außerhalb des Fensters. */
export function slotDay(window: TaskWindow, period: Period, slot: ReminderSlot): string | null {
  if (!allowedDays(window).includes(slot.day)) return null;
  if (window === 'fullMonth') return slot.day >= 1 ? addDays(period.startDay, slot.day - 1) : addDays(period.endDay, slot.day);
  return addDays(period.startDay, slot.day - 1);
}

export function isValidTime(time: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** Kurze Zusammenfassung, z. B. "🔔 Fr, Sa, So 17:00 · So 20:00". */
export function reminderSummary(task: Pick<Task, 'window' | 'reminders'>): string {
  const r = remindersOf(task);
  const slots = r.slots.filter((s) => allowedDays(task.window).includes(s.day) && isValidTime(s.time));
  if (!r.enabled || slots.length === 0) return '🔕 keine Erinnerungen';
  const byTime = new Map<string, number[]>();
  for (const s of slots) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.day]);
  const parts = [...byTime.entries()].map(([time, days]) => `${days.map((d) => dayLabel(task.window, d)).join(', ')} ${time}`);
  return `🔔 ${parts.join(' · ')}`;
}
