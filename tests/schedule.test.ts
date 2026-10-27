import { describe, expect, it } from 'vitest';
import { berlinDay, weekPeriod, windowFor, monthPeriod, type Cadence, type TaskWindow } from '../src/lib/periods';
import {
  buildSnapshot,
  computeSchedule,
  fairShares,
  getBalances,
  isAvailable,
  reassignBadge,
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
    now: new Date('2026-10-27T12:00:00Z'),
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
    const late = new Date('2026-11-16T12:00:00Z'); // beide Wochen sind beendet
    const first = computeSchedule(input({ until: new Date('2026-11-15T12:00:00Z'), now: late }));
    const snaps: Snapshot[] = first.weekly
      .slice(0, 2)
      .map((p) => buildSnapshot(p, '2026-10-26T06:00:00Z'));
    // Nachträgliche Abwesenheit, die die Vergangenheit verändern würde
    const changed = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-26', '2026-11-01')],
        snapshots: snaps,
        until: new Date('2026-11-15T12:00:00Z'),
        now: late,
      }),
    );
    expect(holders(changed, 'weekly', '2026-W44')).toEqual(holders(first, 'weekly', '2026-W44'));
    expect(holders(changed, 'weekly', '2026-W45')).toEqual(holders(first, 'weekly', '2026-W45'));
    expect(changed.weekly[0].frozen).toBe(true);
    expect(changed.weekly[2].frozen).toBe(false);
  });
});

describe('Laufende Woche, Pins und Snapshots (Review-Runde 1)', () => {
  const THU = new Date('2026-10-29T12:00:00Z'); // Donnerstag, KW 44 läuft
  const MON_AFTER = new Date('2026-11-02T08:00:00Z'); // KW 44 beendet

  it('(a) Snapshot wird nur für beendete Perioden benutzt', () => {
    const first = computeSchedule(input({ until: new Date('2026-11-08T12:00:00Z'), now: THU }));
    const snap = buildSnapshot(first.weekly[0], '2026-10-26T06:00:00Z');
    // Absichtlich abweichender eingefrorener Stand
    const tampered = { ...snap, items: { ...snap.items, saugen: { ...snap.items.saugen, memberId: 'paul' } } };
    const liveNow = computeSchedule(input({ snapshots: [tampered], until: new Date('2026-11-08T12:00:00Z'), now: THU }));
    expect(liveNow.weekly[0].frozen).toBe(false);
    expect(holders(liveNow, 'weekly', '2026-W44').saugen).not.toBe('paul');
    const afterEnd = computeSchedule(input({ snapshots: [tampered], until: new Date('2026-11-08T12:00:00Z'), now: MON_AFTER }));
    expect(afterEnd.weekly[0].frozen).toBe(true);
    expect(holders(afterEnd, 'weekly', '2026-W44').saugen).toBe('paul');
  });

  it('(b) Abwesenheit Fr–So mitten in der laufenden Woche: Saugen/Küche wandern, Müll bleibt verfügbar', () => {
    const s = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-30', '2026-11-01')],
        until: new Date('2026-11-01T12:00:00Z'),
        now: THU,
      }),
    );
    const w = holders(s, 'weekly', '2026-W44');
    expect(w.saugen).not.toBe('lucas');
    expect(w.kueche).not.toBe('lucas');
    expect(w.muell).not.toBeNull();
    const muell = s.weekly[0].assignments.find((a) => a.taskId === 'muell')!;
    expect(muell.eligible).toContain('lucas');
    const sau = s.weekly[0].assignments.find((a) => a.taskId === 'saugen')!;
    expect(sau.reassigned).toBe(true);
    expect(sau.absentMemberIds).toContain('lucas');
  });

  it('(c) Bereits von Paul abgehakter Müll bleibt bei Paul, auch wenn er danach Fr–So weg ist', () => {
    const s = computeSchedule(
      input({
        absences: [abs('p', 'paul', '2026-10-30', '2026-11-01')],
        pins: { '2026-W44': { muell: 'paul' } },
        until: new Date('2026-11-01T12:00:00Z'),
        now: THU,
      }),
    );
    expect(holders(s, 'weekly', '2026-W44').muell).toBe('paul');
  });

  it('neue Aufgabe mitten in der laufenden Woche erscheint sofort', () => {
    const late = { ...task('neu', 'weekly', 'fullWeek'), createdAt: '2026-10-27T10:00:00+01:00' };
    const s = computeSchedule(
      input({ tasks: [...WEEKLY, late], until: new Date('2026-11-01T12:00:00Z'), now: new Date('2026-10-28T12:00:00Z') }),
    );
    expect(Object.keys(holders(s, 'weekly', '2026-W44'))).toContain('neu');
  });
});

describe('Max-min-faires Soll (Review-Runde 2)', () => {
  const ALL = ['lucas', 'marleen', 'paul'];
  const close = (shares: Record<string, number>, expected: Record<string, number>) => {
    for (const k of Object.keys(expected)) expect(shares[k], k).toBeCloseTo(expected[k], 6);
  };

  it('(a) Lucas nur für Müll verfügbar, drei Aufgaben mit Gewicht 1 -> Soll 1/1/1', () => {
    const shares = fairShares(
      [
        { weight: 1, eligible: ['marleen', 'paul'] }, // Saugen
        { weight: 1, eligible: ['marleen', 'paul'] }, // Küche
        { weight: 1, eligible: ALL }, // Müll (nur Lucas wäre sonst zu wenig)
      ],
      ALL,
    );
    // Lucas ist nur bei Müll dabei; das Gleichgewicht verlangt 1/1/1
    close(shares, { lucas: 1, marleen: 1, paul: 1 });
  });

  it('(b) Lucas komplett weg -> Soll 0 / 1,5 / 1,5', () => {
    const shares = fairShares(
      [
        { weight: 1, eligible: ['marleen', 'paul'] },
        { weight: 1, eligible: ['marleen', 'paul'] },
        { weight: 1, eligible: ['marleen', 'paul'] },
      ],
      ALL,
    );
    close(shares, { lucas: 0, marleen: 1.5, paul: 1.5 });
  });

  it('(c) Gewichte 3,1,1 alle da -> Soll je 5/3', () => {
    const shares = fairShares(
      [
        { weight: 3, eligible: ALL },
        { weight: 1, eligible: ALL },
        { weight: 1, eligible: ALL },
      ],
      ALL,
    );
    close(shares, { lucas: 5 / 3, marleen: 5 / 3, paul: 5 / 3 });
  });

  it('Niemand verfügbar -> Soll 0 und keine Division durch null', () => {
    const shares = fairShares([{ weight: 2, eligible: [] }], ALL);
    close(shares, { lucas: 0, marleen: 0, paul: 0 });
  });

  it('(d) KW1: Lucas nur für Müll verfügbar, KW2 alle da -> in KW2 bekommt jeder genau eine Aufgabe', () => {
    const s = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-30', '2026-11-01')], // Fr–So KW44
        until: new Date('2026-11-08T12:00:00Z'),
        now: new Date('2026-11-09T12:00:00Z'),
      }),
    );
    const kw2 = holders(s, 'weekly', '2026-W45');
    const counts = countBy(Object.values(kw2));
    for (const m of MEMBERS) expect(counts[m.id], m.name).toBe(1);
  });

  it('Soll-Summe bleibt Gesamtgewicht, Lucas (nur bei Müll verfügbar) wie die anderen', () => {
    const s = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-30', '2026-11-01')],
        until: new Date('2026-11-01T12:00:00Z'),
        now: new Date('2026-10-29T12:00:00Z'),
      }),
    );
    const p = s.weekly[0];
    expect(p.soll.lucas).toBeCloseTo(p.soll.marleen, 6); // Lucas ist bei Müll verfügbar: gleiches Soll
    expect(p.soll.lucas + p.soll.marleen + p.soll.paul).toBeCloseTo(3, 6);
  });
});

describe('Umverteilungs-Badge (Review-Runde 2)', () => {
  const nameOf = (id: string) => ({ lucas: 'Lucas', marleen: 'Marleen', paul: 'Paul' })[id] ?? id;
  const base = {
    taskId: 't', name: 't', weight: 1, memberId: 'marleen', eligible: ['marleen', 'paul'],
    frozen: false, absentMemberIds: [] as string[], takenFor: null as string | null,
  };

  it('ideale Person abwesend -> "übernommen für <Name> (abwesend)"', () => {
    expect(reassignBadge({ ...base, reassigned: true, takenFor: 'lucas', absentMemberIds: ['lucas'] }, nameOf)).toBe(
      'übernommen für Lucas (abwesend)',
    );
  });

  it('ideale Person verfügbar, Abwesenheit in der Periode -> "getauscht wegen Abwesenheit von <Namen>"', () => {
    expect(reassignBadge({ ...base, reassigned: true, takenFor: null, absentMemberIds: ['lucas'] }, nameOf)).toBe(
      'getauscht wegen Abwesenheit von Lucas',
    );
  });

  it('keine Abwesenheit, nur Historie -> kein Badge', () => {
    expect(reassignBadge({ ...base, reassigned: true, takenFor: null, absentMemberIds: [] }, nameOf)).toBeNull();
    expect(reassignBadge({ ...base, reassigned: false }, nameOf)).toBeNull();
  });

  it('Schedule: Saugen von Lucas (abwesend Fr–So) bekommt den Grund-Text mit Namen', () => {
    const s = computeSchedule(
      input({ absences: [abs('l', 'lucas', '2026-10-30', '2026-11-01')], until: new Date('2026-11-01T12:00:00Z'), now: new Date('2026-10-29T12:00:00Z') }),
    );
    const sau = s.weekly[0].assignments.find((a) => a.taskId === 'saugen')!;
    expect(sau.reassigned).toBe(true);
    expect(reassignBadge(sau, nameOf)).toMatch(/^(übernommen für Lucas \(abwesend\)|getauscht wegen Abwesenheit von Lucas)$/);
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
      now: new Date('2026-10-27T12:00:00Z'),
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

describe('Plan läuft unbegrenzt weiter', () => {
  it('erzeugt auch Jahre nach dem Start lückenlos Wochen und Monate mit Zuteilung', () => {
    const now = new Date('2029-06-13T12:00:00Z');
    const s = computeSchedule(input({ now, until: new Date(now.getTime() + 100 * 86_400_000) }));
    const upcomingWeeks = s.weekly.filter((p) => p.period.endDay >= berlinDay(now)).slice(0, 5);
    expect(upcomingWeeks).toHaveLength(5);
    for (let i = 1; i < upcomingWeeks.length; i++) {
      expect(upcomingWeeks[i].period.startDay > upcomingWeeks[i - 1].period.endDay).toBe(true);
    }
    for (const p of upcomingWeeks) {
      expect(p.assignments).toHaveLength(WEEKLY.length);
      expect(p.assignments.every((a) => a.memberId !== null)).toBe(true);
    }
    expect(s.monthly.filter((p) => p.period.endDay >= berlinDay(now)).length).toBeGreaterThanOrEqual(3);
  });
});
