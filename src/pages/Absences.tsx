import { useState } from 'react';
import { Button, Card, Field, SectionTitle, inputClass } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { formatDayRangeShort } from '../lib/periods';
import { newId } from '../lib/crypto';
import type { Absence } from '../lib/types';

export function Absences() {
  const { members, memberById, absences, store, today, schedule, currentMember } = useApp();
  const [memberId, setMemberId] = useState(currentMember?.id ?? members[0]?.id ?? '');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId) return setError('Bitte eine Person wählen.');
    if (to < from) return setError('Das Enddatum liegt vor dem Startdatum.');
    setError(null);
    // Firestore lehnt undefined-Felder ab, daher Notiz nur setzen, wenn vorhanden.
    const absence: Absence = { id: newId(), memberId, from, to, ...(note.trim() ? { note: note.trim() } : {}) };
    await store.saveAbsence(absence);
    setNote('');
  };

  // Wie viele künftige Aufgaben verschiebt diese Abwesenheit?
  const impact = (a: Absence): number => {
    let n = 0;
    for (const ps of [...schedule.weekly, ...schedule.monthly]) {
      if (ps.period.endDay < a.from || ps.period.startDay > a.to) continue;
      n += ps.assignments.filter((x) => x.takenFor === a.memberId || x.swapBecause === a.memberId).length;
    }
    return n;
  };

  const sorted = [...absences].sort((x, y) => (x.from < y.from ? 1 : x.from > y.from ? -1 : 0));

  return (
    <div className="pt-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Abwesenheiten</h1>
      <p className="text-sm text-[var(--muted)]">Ganze Tage. Wer mehr als die Hälfte eines Zeitraums weg ist, bekommt dort nichts zugeteilt.</p>

      <Card className="mt-4 p-4">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Person">
            <select className={inputClass} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Von">
              <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Bis (inkl.)">
              <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label="Notiz (optional)">
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Urlaub" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full">
            Abwesenheit eintragen
          </Button>
        </form>
      </Card>

      <SectionTitle>Eingetragen</SectionTitle>
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Keine Abwesenheiten.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((a) => {
            const m = memberById.get(a.memberId);
            const past = a.to < today;
            const n = impact(a);
            return (
              <li key={a.id}>
                <Card className={`flex items-start gap-3 p-3 ${past ? 'opacity-50' : ''}`}>
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: m?.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m?.name ?? 'Unbekannt'}</div>
                    <div className="text-sm text-[var(--muted)]">{formatDayRangeShort({ startDay: a.from, endDay: a.to })}</div>
                    {a.note && <div className="text-xs text-[var(--muted)]">{a.note}</div>}
                    <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {n > 0 ? `Verschiebt ${n} Aufgabe${n === 1 ? '' : 'n'} im Plan` : 'Keine Auswirkung auf den Plan'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-sm font-medium text-red-600"
                    onClick={() => {
                      if (window.confirm('Abwesenheit löschen?')) void store.deleteAbsence(a.id);
                    }}
                  >
                    Löschen
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
