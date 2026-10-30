import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Zeitraum-Logik. Alle "Tage" sind reine Kalendertage in Europe/Dublin (Irland) im Format YYYY-MM-DD.
 * Rechnungen mit Kalendertagen laufen über UTC-Mitternacht und sind daher frei von
 * Zeitumstellungs-Fehlern. Nur die Umrechnung in echte Zeitpunkte (Date) nutzt die Zeitzone.
 */

export const TZ = 'Europe/Dublin';
const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export type Cadence = 'weekly' | 'monthly';
export type TaskWindow = 'weekend' | 'fullWeek' | 'fullMonth';
export type Day = string;

/** Inklusiver Kalendertagesbereich. */
export interface DayRange {
  startDay: Day;
  endDay: Day;
}

/** Periode (Woche oder Monat) mit inklusiven Kalendertagen. */
export interface Period extends DayRange {
  cadence: Cadence;
  key: string;
}

/** Kalendertag -> Millisekunden (UTC-Mitternacht). */
function dayMs(day: Day): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function msToDay(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  return msToDay(dayMs(day) + n * DAY_MS);
}

/** Anzahl Tage von a bis b, beide inklusiv. */
export function countDays(range: DayRange): number {
  return Math.round((dayMs(range.endDay) - dayMs(range.startDay)) / DAY_MS) + 1;
}

/** 0 = Montag ... 6 = Sonntag. */
export function weekdayIndex(day: Day): number {
  return (new Date(dayMs(day)).getUTCDay() + 6) % 7;
}

/** Kalendertag (Irland) eines Zeitpunkts. */
export function berlinDay(instant: Date): Day {
  return formatInTimeZone(instant, TZ, 'yyyy-MM-dd');
}

/** Zeitpunkt des Beginns (00:00 irischer Zeit) eines Kalendertags. */
export function dayStart(day: Day): Date {
  return fromZonedTime(`${day}T00:00:00`, TZ);
}

/** Exklusives Ende eines inklusiven Tagesbereichs (Beginn des Folgetags, 00:00 irischer Zeit). */
export function rangeEnd(range: DayRange): Date {
  return dayStart(addDays(range.endDay, 1));
}

export function mondayOf(day: Day): Day {
  return addDays(day, -weekdayIndex(day));
}

/** ISO-Wochenschlüssel, z. B. "2026-W45", zu einem Montag. */
function isoWeekKey(monday: Day): string {
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const jan1 = dayMs(`${year}-01-01`);
  const ordinal = Math.round((dayMs(thursday) - jan1) / DAY_MS); // 0-basiert
  const week = Math.floor(ordinal / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekPeriod(day: Day): Period {
  const startDay = mondayOf(day);
  return {
    cadence: 'weekly',
    key: isoWeekKey(startDay),
    startDay,
    endDay: addDays(startDay, 6),
  };
}

export function monthPeriod(day: Day): Period {
  const [y, m] = day.split('-').map(Number);
  const startDay = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    cadence: 'monthly',
    key: `${y}-${String(m).padStart(2, '0')}`,
    startDay,
    endDay: `${y}-${String(m).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`,
  };
}

/** Periode, die den Kalendertag enthält. */
export function periodOf(cadence: Cadence, day: Day): Period {
  return cadence === 'weekly' ? weekPeriod(day) : monthPeriod(day);
}

/** Periode, die den Zeitpunkt (Irland) enthält. */
export function periodAt(cadence: Cadence, instant: Date): Period {
  return periodOf(cadence, berlinDay(instant));
}

export function nextPeriod(period: Period): Period {
  return periodOf(period.cadence, addDays(period.endDay, 1));
}

/** Alle Perioden, die den Bereich [fromDay, toDay] überlappen, in Reihenfolge. */
export function periodsBetween(cadence: Cadence, fromDay: Day, toDay: Day): Period[] {
  const result: Period[] = [];
  let p = periodOf(cadence, fromDay);
  while (p.startDay <= toDay) {
    result.push(p);
    p = nextPeriod(p);
  }
  return result;
}

/**
 * Tagesbereich einer Aufgabe innerhalb ihrer Periode.
 * weekend = Freitag bis Sonntag der Woche, fullWeek = ganze Woche, fullMonth = ganzer Monat.
 */
export function windowFor(period: Period, window: TaskWindow): DayRange {
  if (window === 'weekend') {
    if (period.cadence !== 'weekly') throw new Error('Wochenend-Fenster nur für wöchentliche Perioden');
    return { startDay: addDays(period.startDay, 4), endDay: period.endDay };
  }
  if (window === 'fullWeek') {
    if (period.cadence !== 'weekly') throw new Error('Ganze-Woche-Fenster nur für wöchentliche Perioden');
    return { startDay: period.startDay, endDay: period.endDay };
  }
  if (period.cadence !== 'monthly') throw new Error('Monats-Fenster nur für monatliche Perioden');
  return { startDay: period.startDay, endDay: period.endDay };
}

/** Passt ein Fenster zur Kadenz einer Aufgabe? */
export function isWindowValidFor(cadence: Cadence, window: TaskWindow): boolean {
  return cadence === 'weekly' ? window !== 'fullMonth' : window === 'fullMonth';
}

/** Ein Zeitpunkt innerhalb des Bereichs (Ende exklusiv)? */
export function isInRange(instant: Date, range: DayRange): boolean {
  return instant >= dayStart(range.startDay) && instant < rangeEnd(range);
}

/** Formatiert einen Zeitpunkt als "Mo 02.11. 00:00". */
export function formatDayTime(instant: Date): string {
  const day = berlinDay(instant);
  const wd = WEEKDAY_SHORT[weekdayIndex(day)];
  return `${wd} ${formatInTimeZone(instant, TZ, 'dd.MM. HH:mm')}`;
}

/** Formatiert einen Tagesbereich als "Fr 30.10. 00:00 – So 01.11. 23:59". */
export function formatRange(range: DayRange): string {
  const start = dayStart(range.startDay);
  const end = new Date(rangeEnd(range).getTime() - 60_000); // letzte Minute des Endtags
  return `${formatDayTime(start)} – ${formatDayTime(end)}`;
}

/** Ein Tagesbereich als deutsche Kurzform, z. B. "Mo 02.11. – So 08.11." */
export function formatDayRangeShort(range: DayRange): string {
  const s = dayStart(range.startDay);
  const e = dayStart(range.endDay);
  const fmt = (i: Date) => {
    const day = berlinDay(i);
    return `${WEEKDAY_SHORT[weekdayIndex(day)]} ${formatInTimeZone(i, TZ, 'dd.MM.')}`;
  };
  return `${fmt(s)} – ${fmt(e)}`;
}

/** Monatsname auf Deutsch, z. B. "November 2026". */
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export function periodTitle(period: Period): string {
  if (period.cadence === 'monthly') {
    const [y, m] = period.key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const week = Number(period.key.split('-W')[1]);
  return `KW ${week} · ${formatDayRangeShort(period)}`;
}

/** Verbleibende Zeit bis zum Ende als "noch 2 T 5 Std" bzw. "noch 42 Min". */
export function formatCountdown(now: Date, end: Date): string {
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return 'abgelaufen';
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `noch ${days} T ${hours} Std`;
  if (hours > 0) return `noch ${hours} Std ${minutes} Min`;
  return `noch ${Math.max(minutes, 1)} Min`;
}
