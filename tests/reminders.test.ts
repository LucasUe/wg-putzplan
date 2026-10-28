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
  completions: [],
  sentKeys: new Set(),
  lastAssignments: {},
  ...overrides,
});

// Seit 25.10.2026 gilt MEZ (UTC+1): 17:00 Berlin = 16:00 UTC. Woche KW45 = Mo 02.11. – So 08.11.
const rule = (r: ReturnType<typeof planReminders>, prefix: string) => r.messages.filter((m) => m.key.startsWith(prefix));

describe('Erinnerungen (Europe/Berlin)', () => {
  it('Wochenend-Aufgaben offen: Fr/Sa/So 17:00 und So 20:00, abhakbar', () => {
    for (const at of ['2026-11-06T16:00:00Z', '2026-11-07T16:00:00Z', '2026-11-08T16:00:00Z', '2026-11-08T19:00:00Z']) {
      const we = rule(planReminders(base(at)), 'we-2026-W45-');
      expect(we, at).toHaveLength(2);
      expect(we.every((m) => m.canComplete), at).toBe(true);
      expect(new Set(we.map((m) => m.taskId))).toEqual(new Set(['saugen', 'kueche']));
    }
    const fri = rule(planReminders(base('2026-11-06T16:00:00Z')), 'we-2026-W45-saugen-')[0];
    expect(fri.body).toBe('🧹 Saugen ist noch offen – bis So 08.11. 23:59');
    expect(fri.key).toBe(`we-2026-W45-saugen-${fri.memberId}-2026-11-06T17`);
    expect(fri.periodKey).toBe('2026-W45');
  });

  it('Wochenend-Aufgaben: an anderen Tagen und Zeiten nichts', () => {
    for (const at of ['2026-11-05T16:00:00Z', '2026-11-06T09:00:00Z', '2026-11-06T15:30:00Z', '2026-11-02T16:00:00Z', '2026-11-07T22:00:00Z']) {
      expect(rule(planReminders(base(at)), 'we-'), at).toHaveLength(0);
    }
  });

  it('abgehakte Wochenend-Aufgabe: keine weiteren Nachrichten', () => {
    const done = [{ id: '2026-W45_saugen', periodKey: '2026-W45', taskId: 'saugen', doneBy: 'paul', doneAt: '2026-11-06T12:00:00Z' }];
    for (const at of ['2026-11-06T16:00:00Z', '2026-11-07T16:00:00Z', '2026-11-08T19:00:00Z']) {
      const we = rule(planReminders(base(at, { completions: done })), 'we-');
      expect(we.map((m) => m.taskId), at).toEqual(['kueche']);
    }
  });

  it('Müll: Mo/Mi/Fr/So 17:00 ohne Abhak-Funktion, Di/Do/Sa nichts', () => {
    for (const at of ['2026-11-02T16:00:00Z', '2026-11-04T16:00:00Z', '2026-11-06T16:00:00Z', '2026-11-08T16:00:00Z']) {
      const wk = rule(planReminders(base(at)), 'wk-2026-W45-muell-');
      expect(wk, at).toHaveLength(1);
      expect(wk[0].canComplete).toBe(false);
    }
    const mon = rule(planReminders(base('2026-11-02T16:00:00Z')), 'wk-')[0];
    expect(mon.body).toBe('🗑️ Diese Woche bist du mit Müll runterbringen dran (Mo 02.11. – So 08.11. 23:59)');
    for (const at of ['2026-11-03T16:00:00Z', '2026-11-05T16:00:00Z', '2026-11-07T16:00:00Z']) {
      expect(rule(planReminders(base(at)), 'wk-'), at).toHaveLength(0);
    }
    const done = [{ id: '2026-W45_muell', periodKey: '2026-W45', taskId: 'muell', doneBy: 'lucas', doneAt: '2026-11-03T12:00:00Z' }];
    expect(rule(planReminders(base('2026-11-04T16:00:00Z', { completions: done })), 'wk-')).toHaveLength(0);
  });

  it('verspäteter Lauf: 18:40 holt den 17:00-Termin nach, 20:30 nicht mehr; Dedup verhindert Doppelte', () => {
    const late = planReminders(base('2026-11-06T17:40:00Z')); // Fr 18:40
    expect(rule(late, 'we-2026-W45-')).toHaveLength(2);
    expect(rule(late, 'wk-2026-W45-')).toHaveLength(1);
    const again = planReminders(base('2026-11-06T18:10:00Z', { sentKeys: new Set(late.messages.map((m) => m.key)) }));
    expect(again.messages).toHaveLength(0);
    const tooLate = planReminders(base('2026-11-06T19:30:00Z')); // Fr 20:30, 3,5 h nach 17:00
    expect(tooLate.messages).toHaveLength(0);
  });

  it('Sonntag 20:30: nur der 20:00-Termin, nicht nochmal 17:00', () => {
    const r = planReminders(base('2026-11-08T19:30:00Z'));
    expect(r.messages.every((m) => m.key.endsWith('2026-11-08T20'))).toBe(true);
    expect(rule(r, 'we-')).toHaveLength(2);
  });

  it('1. des Monats 10:00: Monatsaufgaben, abhakbar', () => {
    const r = planReminders(base('2026-11-01T09:00:00Z'));
    const mo = rule(r, 'mo-start-2026-11-');
    expect(mo).toHaveLength(3);
    expect(mo.every((m) => m.canComplete)).toBe(true);
  });

  it('3 Tage vor Monatsende (28.11. 10:00): nur offene Monatsaufgaben', () => {
    expect(rule(planReminders(base('2026-11-28T09:00:00Z')), 'mo-end-')).toHaveLength(3);
    expect(rule(planReminders(base('2026-11-27T09:00:00Z')), 'mo-end-')).toHaveLength(0);
    const done = [{ id: '2026-11_wischen', periodKey: '2026-11', taskId: 'wischen', doneBy: 'paul', doneAt: '2026-11-10T12:00:00Z' }];
    expect(rule(planReminders(base('2026-11-28T09:00:00Z', { completions: done })), 'mo-end-')).toHaveLength(2);
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

  it('Zeitumstellung: Sonntag 25.10. 17:00 MEZ (= 16:00 UTC) wird korrekt erkannt', () => {
    const r = planReminders(base('2026-10-25T16:00:00Z', { startDate: '2026-10-19' }));
    const keys = r.messages.map((m) => m.key);
    expect(keys.filter((k) => k.startsWith('we-2026-W43-') && k.endsWith('2026-10-25T17'))).toHaveLength(2);
    expect(keys.filter((k) => k.startsWith('wk-2026-W43-muell-') && k.endsWith('2026-10-25T17'))).toHaveLength(1);
  });

  it('Snapshots nur für beendete Perioden (laufende Periode bleibt live)', () => {
    const r = planReminders(base('2026-11-03T11:00:00Z'));
    const keys = r.newSnapshots.map((s) => `${s.cadence}:${s.periodKey}`);
    expect(keys).toContain('weekly:2026-W44');
    expect(keys).not.toContain('weekly:2026-W45');
    expect(keys).toContain('monthly:2026-10');
    expect(keys).not.toContain('monthly:2026-11');
  });
});
