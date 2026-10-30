import { describe, expect, it } from 'vitest';
import { berlinDay, weekPeriod, windowFor, monthPeriod, type Cadence, type TaskWindow } from '../src/lib/periods';
import {
  buildSnapshot,
  computeSchedule,
  getBalances,
  isAvailable,
  reassignBadge,
  type Schedule,
  type ScheduleInput,
} from '../src/lib/schedule';
import type { Absence, Member, Override, Task } from '../src/lib/types';

const MEMBERS: Member[] = [
  { id: 'lucas', name: 'Lucas', color: '#3B82F6' },
  { id: 'marleen', name: 'Marlen', color: '#10B981' },
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


const nameOf = (id: string) => MEMBERS.find((m) => m.id === id)?.name ?? id;
const idealOf = (overrides: Partial<ScheduleInput> = {}) => computeSchedule(input({ ...overrides, absences: [], pins: {}, snapshots: [] }));

describe('Abwesenheit: Übernahmen und Tausch', () => {
  const lucasTwoWeeks = input({ absences: [abs('l', 'lucas', '2026-10-26', '2026-11-08')] });

  it('Lucas 2 volle Wochen weg: W1 eine von M/P mit 2 Aufgaben, W2 die andere, W3 = ideale Rotation', () => {
    const s = computeSchedule(lucasTwoWeeks);
    const c1 = countBy(Object.values(holders(s, 'weekly', '2026-W44')));
    const c2 = countBy(Object.values(holders(s, 'weekly', '2026-W45')));
    expect(c1.lucas ?? 0).toBe(0);
    expect(c2.lucas ?? 0).toBe(0);
    expect(Object.values(c1).sort()).toEqual([1, 2]);
    expect(Object.values(c2).sort()).toEqual([1, 2]);
    expect(c2.marleen).toBe(c1.paul);
    expect(c2.paul).toBe(c1.marleen);
    expect(holders(s, 'weekly', '2026-W46')).toEqual(holders(idealOf(), 'weekly', '2026-W46'));
    const b = getBalances(s.weekly, MEMBERS);
    expect(b.find((x) => x.memberId === 'lucas')!.takeovers).toBe(0);
    expect(b.find((x) => x.memberId === 'marleen')!.takeovers).toBe(1);
    expect(b.find((x) => x.memberId === 'paul')!.takeovers).toBe(1);
  });

  it('zwei Personen weg: eine Person macht alles', () => {
    const s = computeSchedule(
      input({ absences: [abs('m', 'marleen', '2026-10-26', '2026-11-01'), abs('p', 'paul', '2026-10-26', '2026-11-01')] }),
    );
    expect(Object.values(holders(s, 'weekly', '2026-W44')).every((v) => v === 'lucas')).toBe(true);
  });

  it('alle weg: Aufgaben bleiben unzugeteilt (null)', () => {
    const s = computeSchedule(input({ absences: MEMBERS.map((m) => abs(m.id, m.id, '2026-10-26', '2026-11-01')) }));
    expect(Object.values(holders(s, 'weekly', '2026-W44')).every((v) => v === null)).toBe(true);
  });

  it('Wochenende: Abwesenheit an 1 von 3 Tagen ändert nichts', () => {
    const one = computeSchedule(input({ absences: [abs('l', 'lucas', '2026-11-08', '2026-11-08')] }));
    expect(holders(one, 'weekly', '2026-W45')).toEqual(holders(idealOf(), 'weekly', '2026-W45'));
  });

  it('wechselnde Abwesenheiten: Lucas weg in KW1 -> Marlen übernimmt; Paul weg in KW5 -> Lucas übernimmt', () => {
    const s = computeSchedule(
      input({
        absences: [abs('l', 'lucas', '2026-10-26', '2026-11-01'), abs('p', 'paul', '2026-11-23', '2026-11-29')],
        until: new Date('2026-11-29T12:00:00Z'),
      }),
    );
    const w1 = s.weekly.find((p) => p.period.key === '2026-W44')!;
    expect(w1.takeovers).toEqual({ lucas: 0, marleen: 1, paul: 0 });
    const w5 = s.weekly.find((p) => p.period.key === '2026-W48')!;
    expect(w5.takeovers).toEqual({ lucas: 1, marleen: 0, paul: 0 });
    const t = w5.assignments.find((a) => a.takenFor === 'paul')!;
    expect(t.memberId).toBe('lucas');
    expect(reassignBadge(t, nameOf)).toBe('übernommen für Paul (abwesend)');
  });

  it('Monatsaufgaben: Lucas den ganzen Dezember weg -> jemand übernimmt, Januar = ideale Rotation', () => {
    const over = { absences: [abs('l', 'lucas', '2026-12-01', '2026-12-31')], until: new Date('2027-02-15T12:00:00Z') };
    const s = computeSchedule(input(over));
    const dec = s.monthly.find((p) => p.period.key === '2026-12')!;
    expect(dec.assignments.every((a) => a.memberId !== 'lucas' && a.memberId !== null)).toBe(true);
    expect(dec.takeovers.marleen + dec.takeovers.paul).toBe(1);
    expect(holders(s, 'monthly', '2027-01')).toEqual(holders(idealOf(over), 'monthly', '2027-01'));
  });
});

describe('Nutzer-Szenario: Lucas 27.11.–08.12.2026', () => {
  const ORDERED: Task[] = [task('kueche', 'weekly', 'weekend'), task('muell', 'weekly', 'fullWeek'), task('saugen', 'weekly', 'weekend')];
  const scenario = (tasks: Task[]) =>
    computeSchedule(
      input({
        tasks,
        absences: [abs('l', 'lucas', '2026-11-27', '2026-12-08')],
        until: new Date('2026-12-27T12:00:00Z'),
        now: new Date('2026-11-10T12:00:00Z'),
      }),
    );
  const ideal = computeSchedule(input({ tasks: ORDERED, until: new Date('2026-12-27T12:00:00Z'), now: new Date('2026-11-10T12:00:00Z') }));

  it('KW48: jede Person genau eine Aufgabe, Lucas Müll per Tausch', () => {
    const s = scenario(ORDERED);
    const w = holders(s, 'weekly', '2026-W48');
    const c = countBy(Object.values(w));
    expect(c).toEqual({ lucas: 1, marleen: 1, paul: 1 });
    expect(w.muell).toBe('lucas');
    const p = s.weekly.find((x) => x.period.key === '2026-W48')!;
    expect(Object.values(p.takeovers).every((v) => v === 0)).toBe(true);
    const sw = p.assignments.find((a) => a.swappedWith !== null && a.memberId !== 'lucas')!;
    expect(reassignBadge(sw, nameOf)).toBe('getauscht mit Lucas wegen Abwesenheit von Lucas');
  });

  it('KW49: Lucas keine Aufgabe, eine Person zwei', () => {
    const c = countBy(Object.values(holders(scenario(ORDERED), 'weekly', '2026-W49')));
    expect(c.lucas ?? 0).toBe(0);
    expect(Object.values(c).sort()).toEqual([1, 2]);
  });

  it('ab KW50: jede Woche identisch mit der idealen Rotation, jede Person genau eine Aufgabe', () => {
    const s = scenario(ORDERED);
    for (const key of ['2026-W50', '2026-W51', '2026-W52']) {
      expect(holders(s, 'weekly', key), key).toEqual(holders(ideal, 'weekly', key));
      expect(countBy(Object.values(holders(s, 'weekly', key))), key).toEqual({ lucas: 1, marleen: 1, paul: 1 });
    }
  });

  it('Reihenfolge-Unabhängigkeit: andere Array-Reihenfolge ergibt denselben Plan', () => {
    const a = scenario(ORDERED);
    const b = scenario([ORDERED[2], ORDERED[0], ORDERED[1]]);
    for (const p of a.weekly) expect(holders(b, 'weekly', p.period.key)).toEqual(holders(a, 'weekly', p.period.key));
  });
});

describe('Aufgaben-Lebenszyklus', () => {
  it('inaktive Aufgaben zählen nicht', () => {
    const tasks = WEEKLY.map((t) => (t.id === 'muell' ? { ...t, active: false } : t));
    expect(Object.keys(holders(computeSchedule(input({ tasks })), 'weekly', '2026-W44'))).not.toContain('muell');
  });

  it('eine neue Aufgabe zählt erst ab ihrer Periode', () => {
    const late = { ...task('neu', 'weekly', 'fullWeek'), createdAt: '2026-11-04T10:00:00+00:00' };
    const s = computeSchedule(input({ tasks: [...WEEKLY, late] }));
    expect(Object.keys(holders(s, 'weekly', '2026-W44'))).not.toContain('neu');
    expect(Object.keys(holders(s, 'weekly', '2026-W45'))).toContain('neu');
  });
});

describe('Snapshots und Pins', () => {
  const THU = new Date('2026-10-29T12:00:00Z');
  const MON_AFTER = new Date('2026-11-02T08:00:00Z');

  it('Snapshot wird nur für beendete Perioden benutzt', () => {
    const first = computeSchedule(input({ until: new Date('2026-11-08T12:00:00Z'), now: THU }));
    const snap = buildSnapshot(first.weekly[0], '2026-10-26T06:00:00Z');
    const other = MEMBERS.find((m) => m.id !== snap.items.saugen.memberId)!.id;
    const tampered = { ...snap, items: { ...snap.items, saugen: { ...snap.items.saugen, memberId: other } } };
    const liveNow = computeSchedule(input({ snapshots: [tampered], until: new Date('2026-11-08T12:00:00Z'), now: THU }));
    expect(liveNow.weekly[0].frozen).toBe(false);
    expect(holders(liveNow, 'weekly', '2026-W44').saugen).not.toBe(other);
    const afterEnd = computeSchedule(input({ snapshots: [tampered], until: new Date('2026-11-08T12:00:00Z'), now: MON_AFTER }));
    expect(afterEnd.weekly[0].frozen).toBe(true);
    expect(holders(afterEnd, 'weekly', '2026-W44').saugen).toBe(other);
  });

  it('eingefrorene Perioden bleiben bei späteren Abwesenheiten gleich', () => {
    const late = new Date('2026-11-16T12:00:00Z');
    const first = computeSchedule(input({ until: new Date('2026-11-15T12:00:00Z'), now: late }));
    const snaps = first.weekly.slice(0, 2).map((p) => buildSnapshot(p, '2026-10-26T06:00:00Z'));
    const changed = computeSchedule(
      input({ absences: [abs('l', 'lucas', '2026-10-26', '2026-11-01')], snapshots: snaps, until: new Date('2026-11-15T12:00:00Z'), now: late }),
    );
    expect(holders(changed, 'weekly', '2026-W44')).toEqual(holders(first, 'weekly', '2026-W44'));
    expect(changed.weekly[2].frozen).toBe(false);
  });

  it('Snapshot speichert takeover/swapWith; alter Snapshot ohne Felder wird korrekt gezählt', () => {
    const over = { absences: [abs('l', 'lucas', '2026-10-26', '2026-11-01')], until: new Date('2026-11-08T12:00:00Z'), now: new Date('2026-11-03T12:00:00Z') };
    const live = computeSchedule(input(over));
    const snap = buildSnapshot(live.weekly[0], '2026-11-02T00:00:00Z');
    expect(Object.values(snap.items).filter((i) => i.takeover)).toHaveLength(1);
    const legacy = {
      ...snap,
      items: Object.fromEntries(Object.entries(snap.items).map(([k, v]) => [k, { memberId: v.memberId, weight: v.weight, eligible: v.eligible }])),
    };
    const fromLegacy = computeSchedule(input({ ...over, snapshots: [legacy] }));
    expect(fromLegacy.weekly[0].frozen).toBe(true);
    expect(fromLegacy.weekly[0].takeovers).toEqual(live.weekly[0].takeovers);
    expect(getBalances(fromLegacy.weekly, MEMBERS)).toEqual(getBalances(live.weekly, MEMBERS));
  });

  it('Abwesenheit Fr–So mitten in der laufenden Woche: Lucas bekommt keine Wochenendaufgabe', () => {
    const s = computeSchedule(input({ absences: [abs('l', 'lucas', '2026-10-30', '2026-11-01')], until: new Date('2026-11-01T12:00:00Z'), now: THU }));
    const w = holders(s, 'weekly', '2026-W44');
    expect(w.saugen).not.toBe('lucas');
    expect(w.kueche).not.toBe('lucas');
    expect(countBy(Object.values(w))).toEqual({ lucas: 1, marleen: 1, paul: 1 });
  });

  it('Pin: abgehakte Aufgabe bleibt bei der abhakenden Person, auch bei späterer Abwesenheit', () => {
    const s = computeSchedule(
      input({ absences: [abs('p', 'paul', '2026-10-30', '2026-11-01')], pins: { '2026-W44': { saugen: 'paul' } }, until: new Date('2026-11-01T12:00:00Z'), now: THU }),
    );
    expect(holders(s, 'weekly', '2026-W44').saugen).toBe('paul');
    const s2 = computeSchedule(input({ pins: { '2026-W44': { muell: 'marleen' } }, until: new Date('2026-11-01T12:00:00Z'), now: THU }));
    expect(holders(s2, 'weekly', '2026-W44').muell).toBe('marleen');
  });

  it('neue Aufgabe mitten in der laufenden Woche erscheint sofort', () => {
    const late = { ...task('neu', 'weekly', 'fullWeek'), createdAt: '2026-10-27T10:00:00+00:00' };
    const s = computeSchedule(input({ tasks: [...WEEKLY, late], until: new Date('2026-11-01T12:00:00Z'), now: new Date('2026-10-28T12:00:00Z') }));
    expect(Object.keys(holders(s, 'weekly', '2026-W44'))).toContain('neu');
  });
});

describe('Manuelles Abgeben und Tauschen (Overrides)', () => {
  const NOW = new Date('2026-10-27T12:00:00Z'); // KW44 läuft
  const UNTIL = new Date('2026-11-15T12:00:00Z');
  const ov = (taskId: string, memberId: string, kind: 'handover' | 'swap', createdBy: string, partnerTaskId?: string, periodKey = '2026-W44'): Override => ({
    id: `${periodKey}_${taskId}`, periodKey, cadence: 'weekly', taskId, memberId, kind, createdBy, createdAt: '2026-10-27T10:00:00Z',
    ...(partnerTaskId ? { partnerTaskId } : {}),
  });
  const base = computeSchedule(input({ now: NOW, until: UNTIL }));
  const w44 = holders(base, 'weekly', '2026-W44');
  const lucasTask = Object.keys(w44).find((k) => w44[k] === 'lucas')!;
  const paulTask = Object.keys(w44).find((k) => w44[k] === 'paul')!;

  it('handover: Aufgabe geht an Paul, Rest bleibt, Zähler unverändert, Folgewoche ideal', () => {
    const s = computeSchedule(input({ now: NOW, until: UNTIL, overrides: [ov(lucasTask, 'paul', 'handover', 'lucas')] }));
    const w = holders(s, 'weekly', '2026-W44');
    expect(w[lucasTask]).toBe('paul');
    for (const k of Object.keys(w)) if (k !== lucasTask) expect(w[k]).toBe(w44[k]);
    expect(Object.values(s.weekly[0].takeovers).every((v) => v === 0)).toBe(true);
    expect(holders(s, 'weekly', '2026-W45')).toEqual(holders(base, 'weekly', '2026-W45'));
    const a = s.weekly[0].assignments.find((x) => x.taskId === lucasTask)!;
    expect(a.overrideKind).toBe('handover');
    expect(reassignBadge(a, nameOf)).toBe('von Lucas abgegeben');
  });

  it('swap: beide Aufgaben getauscht, jeder weiter genau eine Aufgabe', () => {
    const s = computeSchedule(
      input({ now: NOW, until: UNTIL, overrides: [ov(lucasTask, 'paul', 'swap', 'lucas', paulTask), ov(paulTask, 'lucas', 'swap', 'lucas', lucasTask)] }),
    );
    const w = holders(s, 'weekly', '2026-W44');
    expect(w[lucasTask]).toBe('paul');
    expect(w[paulTask]).toBe('lucas');
    expect(countBy(Object.values(w))).toEqual({ lucas: 1, marleen: 1, paul: 1 });
    const a = s.weekly[0].assignments.find((x) => x.taskId === paulTask)!;
    expect(reassignBadge(a, nameOf)).toBe('getauscht mit Paul');
    expect(reassignBadge(s.weekly[0].assignments.find((x) => x.taskId === lucasTask)!, nameOf)).toBe('getauscht mit Lucas');
  });

  it('Override auf eine abwesende Person wird ignoriert', () => {
    const s = computeSchedule(
      input({ now: NOW, until: UNTIL, absences: [abs('p', 'paul', '2026-10-26', '2026-11-01')], overrides: [ov(lucasTask, 'paul', 'handover', 'lucas')] }),
    );
    expect(holders(s, 'weekly', '2026-W44')[lucasTask]).not.toBe('paul');
  });

  it('Pin schlägt Override', () => {
    const s = computeSchedule(
      input({ now: NOW, until: UNTIL, overrides: [ov(lucasTask, 'paul', 'handover', 'lucas')], pins: { '2026-W44': { [lucasTask]: 'lucas' } } }),
    );
    const a = s.weekly[0].assignments.find((x) => x.taskId === lucasTask)!;
    expect(a.memberId).toBe('lucas');
    expect(a.overrideKind).toBeNull();
  });

  it('eingefrorene Periode ignoriert Override, Snapshot behält Abgabe-Badge', () => {
    const later = new Date('2026-11-03T12:00:00Z');
    const withOv = computeSchedule(input({ now: NOW, until: UNTIL, overrides: [ov(lucasTask, 'paul', 'handover', 'lucas')] }));
    const snap = buildSnapshot(withOv.weekly[0], '2026-11-02T00:00:00Z');
    expect(snap.items[lucasTask].override).toBe('handover');
    // Snapshot ohne Override, aber Override-Dokument vorhanden: Override wird ignoriert
    const plainSnap = buildSnapshot(base.weekly[0], '2026-11-02T00:00:00Z');
    const frozen = computeSchedule(input({ now: later, until: UNTIL, snapshots: [plainSnap], overrides: [ov(lucasTask, 'paul', 'handover', 'lucas')] }));
    expect(holders(frozen, 'weekly', '2026-W44')[lucasTask]).toBe('lucas');
    const frozenOv = computeSchedule(input({ now: later, until: UNTIL, snapshots: [snap] }));
    const a = frozenOv.weekly[0].assignments.find((x) => x.taskId === lucasTask)!;
    expect(a.memberId).toBe('paul');
    expect(reassignBadge(a, nameOf)).toBe('von Lucas abgegeben');
  });

  it('Abgabe einer Übernahme: Zähler bleibt bei der übernehmenden Person', () => {
    const absences = [abs('l', 'lucas', '2026-10-26', '2026-11-01')];
    const noOv = computeSchedule(input({ now: NOW, until: UNTIL, absences }));
    const t = noOv.weekly[0].assignments.find((x) => x.takenFor === 'lucas')!;
    const taker = t.memberId!;
    const other = taker === 'paul' ? 'marleen' : 'paul';
    const s = computeSchedule(input({ now: NOW, until: UNTIL, absences, overrides: [ov(t.taskId, other, 'handover', taker)] }));
    expect(s.weekly[0].takeovers).toEqual(noOv.weekly[0].takeovers);
    expect(holders(s, 'weekly', '2026-W44')[t.taskId]).toBe(other);
  });
});

describe('Umverteilungs-Badge', () => {
  const base = {
    taskId: 't', name: 't', weight: 1, memberId: 'marleen', idealMemberId: 'lucas', eligible: ['marleen', 'paul'],
    frozen: false, takenFor: null as string | null, swappedWith: null as string | null, swapBecause: null as string | null,
    takeoverBy: null as string | null, overrideKind: null as 'handover' | 'swap' | null, overrideFrom: null as string | null,
  };
  it('Übernahme', () => {
    expect(reassignBadge({ ...base, reassigned: true, takenFor: 'lucas' }, nameOf)).toBe('übernommen für Lucas (abwesend)');
  });
  it('Tausch', () => {
    expect(reassignBadge({ ...base, reassigned: true, swappedWith: 'lucas', swapBecause: 'lucas' }, nameOf)).toBe(
      'getauscht mit Lucas wegen Abwesenheit von Lucas',
    );
  });
  it('sonst kein Badge', () => {
    expect(reassignBadge({ ...base, reassigned: true }, nameOf)).toBeNull();
    expect(reassignBadge({ ...base, reassigned: false, takenFor: 'lucas' }, nameOf)).toBeNull();
  });
});

describe('Langzeit (52 Wochen, zufällige Abwesenheiten, fester Seed)', () => {
  it('Zuteilung nur an Verfügbare, null nur ohne Verfügbare, volle Wochen = ideale Rotation', () => {
    let seed = 20261026;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const absences: Absence[] = [];
    for (let w = 0; w < 52; w++) {
      for (const m of MEMBERS) {
        if (rnd() < 0.2) {
          const from = addDaysStr('2026-10-26', w * 7 + Math.floor(rnd() * 7));
          absences.push(abs(`${m.id}-${w}`, m.id, from, addDaysStr(from, Math.floor(rnd() * 10))));
        }
      }
    }
    const over = { until: new Date('2027-10-20T12:00:00Z') };
    const s = computeSchedule(input({ ...over, absences }));
    const ideal = idealOf(over);
    for (const p of [...s.weekly, ...s.monthly]) {
      for (const a of p.assignments) {
        if (a.memberId === null) expect(a.eligible).toHaveLength(0);
        else expect(a.eligible).toContain(a.memberId);
      }
      if (p.assignments.every((a) => a.eligible.length === MEMBERS.length)) {
        const idealP = (p.period.cadence === 'weekly' ? ideal.weekly : ideal.monthly).find((x) => x.period.key === p.period.key)!;
        expect(p.assignments.map((a) => a.memberId)).toEqual(idealP.assignments.map((a) => a.memberId));
      }
    }
  });
});

describe('Zeitumstellung 25.10.2026', () => {
  it('Wochen und Tage bleiben über die Umstellung korrekt zugeordnet', () => {
    expect(berlinDay(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-25'); // So 23:30 (irische Zeit, GMT)
    expect(berlinDay(new Date('2026-10-26T00:30:00Z'))).toBe('2026-10-26'); // Mo 00:30 (irische Zeit, GMT)
    expect(berlinDay(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // So 00:30 (irische Zeit, noch IST)
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
