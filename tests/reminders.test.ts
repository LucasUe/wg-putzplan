import { describe, expect, it } from 'vitest';
import { planReminders, type ReminderInput } from '../scripts/reminder-logic';
import { seedHousehold, seedTasks } from '../src/lib/seed';

const hh = seedHousehold('x');
const base = (now: string, overrides: Partial<ReminderInput> = {}): ReminderInput => ({
  now: new Date(now),
  members: hh.members,
  tasks: seedTasks(),
  absences: [],
  startDate: hh.startDate,
  snapshots: [],
  completionIds: new Set(),
  sentKeys: new Set(),
  lastAssignments: {},
  ...overrides,
});

describe('Erinnerungen (Europe/Berlin)', () => {
  // Berlin ist seit 25.10.2026 wieder MEZ (UTC+1)
  it('Montag 09:00 Berlin: jede Person mit Wochenaufgaben bekommt genau eine Nachricht', () => {
    const r = planReminders(base('2026-11-02T08:00:00Z'));
    const weekly = r.messages.filter((m) => m.key.startsWith('wk-mon-'));
    expect(weekly).toHaveLength(3);
    expect(new Set(weekly.map((m) => m.memberId)).size).toBe(3);
    expect(weekly[0].body).toContain('Diese Woche bist du dran mit:');
    expect(weekly[0].body).toContain('Mo 02.11. – So 08.11.');
  });

  it('um 10:00 Berlin wird am Montag nichts gesendet', () => {
    const r = planReminders(base('2026-11-02T09:00:00Z'));
    expect(r.messages.filter((m) => m.key.startsWith('wk-mon-'))).toHaveLength(0);
  });

  it('bereits gesendete Schlüssel werden nicht erneut gesendet (Dedup)', () => {
    const first = planReminders(base('2026-11-02T08:00:00Z'));
    const sent = new Set(first.messages.map((m) => m.key));
    const again = planReminders(base('2026-11-02T08:00:00Z', { sentKeys: sent }));
    expect(again.messages).toHaveLength(0);
  });

  it('Freitag 10:00: nur Wochenend-Aufgaben (Saugen, Küche)', () => {
    const r = planReminders(base('2026-11-06T09:00:00Z'));
    const fri = r.messages.filter((m) => m.key.startsWith('wk-fri-'));
    const bodies = fri.map((m) => m.body).join(' | ');
    expect(bodies).toContain('Dieses Wochenende:');
    expect(bodies).not.toContain('Müll');
    expect(fri.length).toBeGreaterThanOrEqual(1);
    expect(fri.length).toBeLessThanOrEqual(2);
  });

  it('Sonntag 18:00: erinnert nur an offene Aufgaben', () => {
    const all = planReminders(base('2026-11-08T17:00:00Z'));
    const sun = all.messages.filter((m) => m.key.startsWith('wk-sun-'));
    expect(sun).toHaveLength(3);
    // Alles erledigt -> keine Erinnerung
    const ids = new Set<string>();
    for (const t of seedTasks().filter((t) => t.cadence === 'weekly')) ids.add(`2026-W45_${t.id}`);
    const done = planReminders(base('2026-11-08T17:00:00Z', { completionIds: ids }));
    expect(done.messages.filter((m) => m.key.startsWith('wk-sun-'))).toHaveLength(0);
  });

  it('1. des Monats 10:00 Berlin: Monatsaufgaben', () => {
    const r = planReminders(base('2026-11-01T09:00:00Z'));
    const monthly = r.messages.filter((m) => m.key.startsWith('mo-start-'));
    expect(monthly).toHaveLength(3);
  });

  it('3 Tage vor Monatsende (28.11. 10:00): offene Monatsaufgaben', () => {
    const r = planReminders(base('2026-11-28T09:00:00Z'));
    expect(r.messages.filter((m) => m.key.startsWith('mo-end-'))).toHaveLength(3);
    const other = planReminders(base('2026-11-27T09:00:00Z'));
    expect(other.messages.filter((m) => m.key.startsWith('mo-end-'))).toHaveLength(0);
  });

  it('Umverteilung: "Neu zugeteilt" an die neue Person, wenn sich die Zuteilung gegenüber dem Stand ändert', () => {
    // Stand zuerst ermitteln, dann einen Eintrag absichtlich anders melden
    const first = planReminders(base('2026-11-03T11:00:00Z'));
    const w45 = first.schedule.weekly.find((p) => p.period.key === '2026-W45')!;
    const saugen = w45.assignments.find((a) => a.taskId === 'saugen')!;
    const other = hh.members.find((m) => m.id !== saugen.memberId)!.id;
    const prev: Record<string, Record<string, string | null>> = {
      '2026-W45': Object.fromEntries(w45.assignments.map((a) => [a.taskId, a.taskId === 'saugen' ? other : a.memberId])),
    };
    const r = planReminders(base('2026-11-03T11:00:00Z', { lastAssignments: prev }));
    const neu = r.messages.filter((m) => m.title === 'Neu zugeteilt');
    expect(neu).toHaveLength(1);
    expect(neu[0].memberId).toBe(saugen.memberId);
    expect(neu[0].body).toContain('Saugen');
  });

  it('Zeitumstellung: Sonntag 25.10. 18:00 MEZ wird korrekt als Sonntag erkannt', () => {
    const r = planReminders(base('2026-10-25T17:00:00Z', { startDate: '2026-10-19' }));
    expect(r.messages.filter((m) => m.key.startsWith('wk-sun-2026-W43'))).toHaveLength(3);
  });

  it('neue Snapshots nur für begonnene Perioden ohne Snapshot', () => {
    const r = planReminders(base('2026-11-03T11:00:00Z'));
    const keys = r.newSnapshots.map((s) => `${s.cadence}:${s.periodKey}`);
    expect(keys).toContain('weekly:2026-W44');
    expect(keys).toContain('weekly:2026-W45');
    expect(keys).not.toContain('weekly:2026-W46');
    expect(keys).toContain('monthly:2026-10');
    expect(keys).toContain('monthly:2026-11');
  });
});
