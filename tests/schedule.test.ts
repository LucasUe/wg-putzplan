import { describe, expect, it } from 'vitest';
import { berlinDay, weekPeriod, windowFor, monthPeriod, type Cadence, type TaskWindow } from '../src/lib/periods';
import {
  buildSnapshot,
  computeSchedule,
  getBalances,
  isAvailable,
  type Schedule,
  type ScheduleInput,
} from '../src/lib/schedule';
import type { Absence, Member, Snapshot, Task } from '../src/lib/types';

const MEMBERS: Member[] = [
  { id: 'lucas', name: 'Lucas', color: '#3B82F6' },
  { id: 'marleen', name: 'Marleen', color: '#10B981' },
  { id: 'paul', name: 'Paul', color: '#F97316' },
];
const CREATED = '2026-01-01T00:00:00Z';

function task(id: string, cadence: Cadence, window: TaskWindow, weight = 1): Task {
  return { id, name: id, icon: '', cadence, window, weight, active: true, createdAt: CREATED };
}

const WEEKLY: Task[] = [
  task('saugen', 'weekly', 'weekend'),
  task('kueche', 'weekly', 'weekend'),
  task('muell', 'weekly', 'fullWeek'),
];
const MONTHLY: Task[] = [
  task('wischen', 'monthly', 'fullMonth'),
  task('kuehlschrank', 'monthly', 'fullMonth'),
  task('pappe', 'monthly', 'fullMonth'),
];

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    members: MEMBERS,
    tasks: [...WEEKLY, ...MONTHLY],
    absences: [],
    startDate: '2026-10-26',
    snapshots: [],
    until: new Date('2026-11-29T12:00:00Z'), // bis einschließlich November
    ...overrides,
  };
}

const abs = (id: string, memberId: string, from: string, to: string): Absence => ({ id, memberId, from, to });

/** Zuteilung einer Periode als {taskId: memberId} */
function holders(s: Schedule, cadence: Cadence, key: string): Record<string, string | null> {
  const ps = cadence === 'weekly' ? s.weekly : s.monthly;
  const p = ps.find((x) => x.period.key === key);
  if (!p) throw new Error(`Periode ${key} fehlt`);
  return Object.fromEntries(p.assignments.map((a) => [a.taskId, a.memberId]));
}

describe('isAvailable (50-%-Regel)', () => {
  const weekend = { startDay: '2026-11-06', endDay: '2026-11-08' };
  it('1 von 3 Wochenendtagen abwesend -> verfügbar', () => {
    expect(isAvailable('lucas', weekend, [abs('a', 'lucas', '2026-11-08', '2026-11-08')])).toBe(true);
  });
  it('2 von 3 Wochenendtagen abwesend -> nicht verfügbar', () => {
    expect(isAvailable('lucas', weekend, [abs('a', 'lucas', '2026-11-07', '2026-11-08')])).toBe(false);
  });
  it('4 von 7 Tagen der Müllwoche -> nicht verfügbar, 3 von 7 -> verfügbar', () => {
    const week = { startDay: '2026-11-02', endDay: '2026-11-08' };
    expect(isAvailable('lucas', week, [abs('a', 'lucas', '2026-11-02', '2026-11-05')])).toBe(false);
    expect(isAvailable('lucas', week, [abs('a', 'lucas', '2026-11-02', '2026-11-04')])).toBe(true);
  });
  it('überlappende Abwesenheiten zählen Tage nur einmal', () => {
    expect(isAvailable('lucas', weekend, [abs('a', 'lucas', '2026-11-06', '2026-11-06'), abs('b', 'lucas', '2026-11-06', '2026-11-06')])).toBe(true);
  });
  it('Abwesenheit einer anderen Person hat keinen Einfluss', () => {
    expect(isAvailable('lucas', weekend, [abs('a', 'paul', '2026-11-06', '2026-11-08')])).toBe(true);
  });
});

describe('Rotation bei voller Besetzung', () => {
  it('jede Wochenaufgabe wechselt jede Woche den Besitzer', () => {
    const s = computeSchedule(input());
    const w44 = holders(s, 'weekly', '2026-W44');
    const w45 = holders(s, 'weekly', '2026-W45');
    for (const t of WEEKLY) expect(w45[t.id]).not.toBe(w44[t.id]);
  });

  it('nach 3 Wochen hat jede Person jede Wochenaufgabe genau einmal', () => {
    const s = computeSchedule(input());
    const keys = ['2026-W44', '2026-W45', '2026-W46'];
    for (const m of MEMBERS) {
      for (const t of WEEKLY) {
        const count = keys.filter((k) => holders(s, 'weekly', k)[t.id] === m.id).length;
        expect(count, `${m.name} ${t.id}`).toBe(1);
      }
    }
  });

  it('auch in den folgenden 3 Wochen bleibt die Rotation vollständig', () => {
    const s = computeSchedule(input({ until: new Date('2026-12-20T12:00:00Z') }));
    const all = s.weekly.map((p) => p.period.key);
    for (let i = 0; i + 3 <= all.length; i++) {
      const keys = all.slice(i, i + 3);
      for (const m of MEMBERS) {
        for (const t of WEEKLY) {
          const count = keys.filter((k) => holders(s, 'weekly', k)[t.id] === m.id).length;
          expect(count, `${keys.join(',')} ${m.name} ${t.id}`).toBe(1);
        }
      }
    }
  });

  it('monatliche Aufgaben rotieren ebenfalls (3 Monate = jede Person jede Aufgabe einmal)', () => {
    const s = computeSchedule(input({ until: new Date('2027-01-15T12:00:00Z') }));
    const keys = ['2026-10', '2026-11', '2026-12'];
    for (const m of MEMBERS) {
      for (const t of MONTHLY) {
        const count = keys.filter((k) => holders(s, 'monthly', k)[t.id] === m.id).length;
        expect(count, `${m.name} ${t.id}`).toBe(1);
      }
    }
  });
});

describe('Abwesenheit und Umverteilung', () => {
  const lucasTwoWeeks = input({ absences: [abs('l', 'lucas', '2026-10-26', '2026-11-08')] });

  it('Lucas 2 Wochen weg: Woche 1 zwei Personen mit 2 bzw. 1 Aufgaben, danach ausgeglichen', () => {
    const s = computeSchedule(lucasTwoWeeks);
    const w1 = holders(s, 'weekly', '2026-W44');
    const counts1 = countBy(Object.values(w1));
    expect(counts1.lucas ?? 0).toBe(0);
    expect(Object.values(counts1).sort()).toEqual([1, 2]);

    const w2 = holders(s, 'weekly', '2026-W45');
    const counts2 = countBy(Object.values(w2));
    expect(counts2.lucas ?? 0).toBe(0);
    // Die andere Person bekommt in Woche 2 nun zwei Aufgaben
    expect(Object.values(counts2).sort()).toEqual([1, 2]);
    expect(counts2.marleen).toBe(counts1.paul);
    expect(counts2.paul).toBe(counts1.marleen);

    const balances = getBalances(s.weekly.slice(0, 2), MEMBERS);
    expect(balances.find((b) => b.memberId === 'marleen')!.saldo).toBeCloseTo(0, 9);
    expect(balances.find((b) => b.memberId === 'paul')!.saldo).toBeCloseTo(0, 9);
    expect(balances.find((b) => b.memberId === 'lucas')!.saldo).toBeCloseTo(0, 9);
  });

  it('Abwesende bekommen kein Soll und müssen nichts nachholen', () => {
    const s = computeSchedule(lucasTwoWeeks);
    const b = getBalances(s.weekly.slice(0, 2), MEMBERS);
    expect(b.find((x) => x.memberId === 'lucas')!.soll).toBe(0);
  });

  it('zwei Personen weg: eine Person macht alles', () => {
    const s = computeSchedule(
      input({
        absences: [abs('m', 'marleen', '2026-10-26', '2026-11-01'), abs('p', 'paul', '2026-10-26', '2026-11-01')],
      }),
    );
    const w44 = holders(s, 'weekly', '2026-W44');
    expect(Object.values(w44).every((v) => v === 'lucas')).toBe(true);
  });

  it('alle weg: Aufgaben bleiben unzugeteilt (null)', () => {
    const s = computeSchedule(
      input({
        absences: MEMBERS.map((m) => abs(m.id, m.id, '2026-10-26', '2026-11-01')),
      }),
    );
    const w44 = holders(s, 'weekly', '2026-W44');
    expect(Object.values(w44).every((v) => v === null)).toBe(true);
  });

  it('Monatsaufgaben: Lucas im November weg -> nur Marleen und Paul, Ist gleichmäßig', () => {
    const s = computeSchedule(input({ absences: [abs('l', 'lucas', '2026-11-01', '2026-11-30')] }));
    const nov = holders(s, 'monthly', '2026-11');
    expect(Object.values(nov)).not.toContain('lucas');
    const oct = holders(s, 'monthly', '2026-10');
    expect(Object.values(oct)).toContain('lucas');
  });

  it('Wochenende: Abwesenheit an 1 von 3 Tagen ändert nichts, an 2 Tagen wird umverteilt', () => {
    const one = computeSchedule(input({ absences: [abs('l', 'lucas', '2026-11-08', '2026-11-08')] }));
    const two = computeSchedule(input({ absences: [abs('l', 'lucas', '2026-11-07', '2026-11-08')] }));
    const base = computeSchedule(input());
    expect(holders(one, 'weekly', '2026-W45')).toEqual(holders(base, 'weekly', '2026-W45'));
    const twoW45 = holders(two, 'weekly', '2026-W45');
    // Saugen und Küche (Wochenende) dürfen in dieser Woche nicht an Lucas gehen
    expect(twoW45.saugen).not.toBe('lucas');
    expect(twoW45.kueche).not.toBe('lucas');
  });

  it('Umverteilung wird markiert und nennt die abwesende Person', () => {
    const s = computeSchedule(lucasTwoWeeks);
    const flagged = s.weekly[0].assignments.filter((x) => x.reassigned);
    expect(flagged.length).toBeGreaterThan(0);
    for (const x of flagged) expect(x.absentMemberIds).toContain('lucas');
    // Lucas ist nie Besitzer einer Aufgabe in seiner Abwesenheitswoche
    expect(s.weekly[0].assignments.every((x) => x.memberId !== 'lucas')).toBe(true);
  });
});

describe('Aufgaben-Lebenszyklus', () => {
  it('inaktive Aufgaben zählen nicht', () => {
    const tasks = WEEKLY.map((t) => (t.id === 'muell' ? { ...t, active: false } : t));
    const s = computeSchedule(input({ tasks }));
    expect(Object.keys(holders(s, 'weekly', '2026-W44'))).not.toContain('muell');
  });

  it('eine neue Aufgabe zählt erst ab ihrer Periode', () => {
    const late = { ...task('neu', 'weekly', 'fullWeek'), createdAt: '2026-11-04T10:00:00+01:00' };
    const s = computeSchedule(input({ tasks: [...WEEKLY, late] }));
    expect(Object.keys(holders(s, 'weekly', '2026-W44'))).not.toContain('neu');
    expect(Object.keys(holders(s, 'weekly', '2026-W45'))).toContain('neu');
  });
});

describe('Snapshots', () => {
  it('eingefrorene Perioden bleiben bei späteren Änderungen gleich und gehen in die Salden ein', () => {
    const first = computeSchedule(input({ until: new Date('2026-11-15T12:00:00Z') }));
    const snaps: Snapshot[] = first.weekly
      .slice(0, 2)
      .map((p) => buildSnapshot(p, '2026-10-26T06:00:00Z'));
    // Nachträgliche Abwesenheit, die die Vergangenheit verändern würde
    const changed = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-26', '2026-11-01')],
        snapshots: snaps,
        until: new Date('2026-11-15T12:00:00Z'),
      }),
    );
    expect(holders(changed, 'weekly', '2026-W44')).toEqual(holders(first, 'weekly', '2026-W44'));
    expect(holders(changed, 'weekly', '2026-W45')).toEqual(holders(first, 'weekly', '2026-W45'));
    expect(changed.weekly[0].frozen).toBe(true);
    expect(changed.weekly[2].frozen).toBe(false);
  });
});

describe('Zeitumstellung 25.10.2026', () => {
  it('Wochen und Tage bleiben über die Umstellung korrekt zugeordnet', () => {
    expect(berlinDay(new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25'); // So 23:30 MEZ
    expect(berlinDay(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26'); // Mo 00:30 MEZ
  });

  it('Woche 43 und 44 sind lückenlos, Wochenende-Fenster stimmt', () => {
    const s = computeSchedule(input({ startDate: '2026-10-19', until: new Date('2026-10-30T12:00:00Z') }));
    expect(s.weekly.map((p) => p.period.key)).toEqual(['2026-W43', '2026-W44']);
    const w43 = weekPeriod('2026-10-19');
    const weekend = windowFor(w43, 'weekend');
    expect(weekend.startDay).toBe('2026-10-23');
    expect(monthPeriod('2026-10-15').endDay).toBe('2026-10-31');
  });
});

describe('Langzeit-Fairness', () => {
  it('52 Wochen mit zufälligen Abwesenheiten (fester Seed): Saldo-Differenz <= max. Taskgewicht', () => {
    // Deterministischer Zufall (LCG) mit festem Seed
    let seed = 20261026;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const tasks: Task[] = [
      task('saugen', 'weekly', 'weekend', 1),
      task('kueche', 'weekly', 'weekend', 2),
      task('muell', 'weekly', 'fullWeek', 3),
      task('wischen', 'monthly', 'fullMonth', 2),
      task('kuehlschrank', 'monthly', 'fullMonth', 1),
      task('pappe', 'monthly', 'fullMonth', 1),
    ];
    const absences: Absence[] = [];
    for (let w = 0; w < 52; w++) {
      for (const m of MEMBERS) {
        if (rnd() < 0.2) {
          const startOffset = Math.floor(rnd() * 7);
          const days = 1 + Math.floor(rnd() * 10);
          const from = addDaysStr('2026-10-26', w * 7 + startOffset);
          absences.push(abs(`${m.id}-${w}-${startOffset}`, m.id, from, addDaysStr(from, days - 1)));
        }
      }
    }
    const s = computeSchedule({
      members: MEMBERS,
      tasks,
      absences,
      startDate: '2026-10-26',
      snapshots: [],
      until: new Date('2027-10-20T12:00:00Z'),
    });
    const weekly = getBalances(s.weekly, MEMBERS);
    const monthly = getBalances(s.monthly, MEMBERS);
    const spread = (bs: { saldo: number }[]) => Math.max(...bs.map((b) => b.saldo)) - Math.min(...bs.map((b) => b.saldo));
    expect(spread(weekly)).toBeLessThanOrEqual(3);
    expect(spread(monthly)).toBeLessThanOrEqual(2);
  });
});

function countBy(values: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) if (v) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function addDaysStr(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
