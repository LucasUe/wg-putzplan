import { describe, expect, it } from 'vitest';
import {
  addDays,
  countDays,
  dayStart,
  formatRange,
  monthPeriod,
  periodsBetween,
  rangeEnd,
  weekPeriod,
  windowFor,
  weekdayIndex,
} from '../src/lib/periods';

describe('Wochen- und Monatsperioden', () => {
  it('Wochen beginnen am Montag und enden am Sonntag', () => {
    const w = weekPeriod('2026-11-04'); // Mittwoch
    expect(w.startDay).toBe('2026-11-02');
    expect(w.endDay).toBe('2026-11-08');
    expect(w.key).toBe('2026-W45');
  });

  it('ISO-Wochen über Jahreswechsel', () => {
    expect(weekPeriod('2027-01-01').key).toBe('2026-W53');
    expect(weekPeriod('2025-12-29').key).toBe('2026-W01');
  });

  it('Monate haben korrekte Grenzen (inkl. Schaltjahr)', () => {
    expect(monthPeriod('2026-11-15')).toMatchObject({ key: '2026-11', startDay: '2026-11-01', endDay: '2026-11-30' });
    expect(monthPeriod('2028-02-10')).toMatchObject({ key: '2028-02', endDay: '2028-02-29' });
  });

  it('Wochenende-Fenster ist Freitag bis Sonntag, Ganze Woche Mo–So', () => {
    const w = weekPeriod('2026-11-02');
    expect(windowFor(w, 'weekend')).toEqual({ startDay: '2026-11-06', endDay: '2026-11-08' });
    expect(windowFor(w, 'fullWeek')).toEqual({ startDay: '2026-11-02', endDay: '2026-11-08' });
    expect(() => windowFor(monthPeriod('2026-11-02'), 'weekend')).toThrow();
  });

  it('periodsBetween liefert lückenlose Perioden', () => {
    const ws = periodsBetween('weekly', '2026-10-26', '2026-11-15');
    expect(ws.map((p) => p.key)).toEqual(['2026-W44', '2026-W45', '2026-W46']);
    const ms = periodsBetween('monthly', '2026-10-26', '2027-01-03');
    expect(ms.map((p) => p.key)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
  });
});

describe('Zeitzone Europe/Dublin und Zeitumstellung', () => {
  it('Montag 00:00 (irische Zeit) nach der Umstellung am 25.10.2026 liegt bei 00:00 UTC', () => {
    // Umstellung ist am Sonntag 25.10. (IST -> GMT), Montag 26.10. 00:00 ist GMT = UTC+0
    expect(dayStart('2026-10-26').toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('Sommerzeit (IST): 00:00 am 01.10.2026 (irische Zeit) ist UTC 23:00 des 30.09.', () => {
    expect(dayStart('2026-10-01').toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('Woche mit Zeitumstellung (19.–25.10.) hat 169 Stunden (eine Stunde mehr)', () => {
    const w = weekPeriod('2026-10-21');
    const hours = (rangeEnd(w).getTime() - dayStart(w.startDay).getTime()) / 3_600_000;
    expect(w.startDay).toBe('2026-10-19');
    expect(hours).toBe(169);
  });

  it('Formatierung zeigt irische Ortszeit', () => {
    expect(formatRange(windowFor(weekPeriod('2026-10-26'), 'weekend'))).toBe('Fr 30.10. 00:00 – So 01.11. 23:59');
    expect(formatRange(weekPeriod('2026-11-02'))).toBe('Mo 02.11. 00:00 – So 08.11. 23:59');
  });

  it('Tageszählung und Wochentage sind kalendarisch korrekt', () => {
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(weekdayIndex('2026-10-25')).toBe(6);
    expect(countDays({ startDay: '2026-10-26', endDay: '2026-11-01' })).toBe(7);
  });
});
