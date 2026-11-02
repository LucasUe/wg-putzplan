import { useState } from 'react';
import { Button, Card, Field, SectionTitle, Toggle, inputClass } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { newId } from '../lib/crypto';
import type { Cadence, TaskWindow } from '../lib/periods';
import { allowedDays, dayLabel, defaultRemindersFor, isValidTime, reminderSummary, remindersOf, sameReminders } from '../lib/reminders';
import type { Task, TaskReminders } from '../lib/types';

const WINDOW_LABEL: Record<TaskWindow, string> = {
  weekend: 'Wochenende (Fr–So)',
  fullWeek: 'Ganze Woche (Mo–So)',
  fullMonth: 'Ganzer Monat',
};

const CADENCE_LABEL: Record<Cadence, string> = { weekly: 'wöchentlich', monthly: 'monatlich' };

interface Draft {
  id: string | null;
  name: string;
  icon: string;
  cadence: Cadence;
  window: TaskWindow;
  weight: number;
  reminders: TaskReminders;
}

const emptyDraft = (): Draft => ({
  id: null,
  name: '',
  icon: '🧹',
  cadence: 'weekly',
  window: 'weekend',
  weight: 1,
  reminders: defaultRemindersFor('weekend'),
});

export function Tasks() {
  const { tasks, store } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = tasks.filter((t) => t.active).sort((a, b) => a.cadence.localeCompare(b.cadence) || a.name.localeCompare(b.name, 'de'));

  const windowsFor = (c: Cadence): TaskWindow[] => (c === 'weekly' ? ['weekend', 'fullWeek'] : ['fullMonth']);

  const edit = (t: Task) =>
    setDraft({
      id: t.id,
      name: t.name,
      icon: t.icon,
      cadence: t.cadence,
      window: t.window,
      weight: t.weight,
      reminders: structuredClone(remindersOf(t)),
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) return setError('Bitte einen Namen eingeben.');
    if (draft.reminders.slots.some((x) => !isValidTime(x.time))) return setError('Bitte bei jeder Erinnerung eine Uhrzeit angeben.');
    setError(null);
    // Nur speichern, wenn vom Standard abweichend; sonst Feld weglassen (Firestore: kein undefined)
    const custom = sameReminders(draft.reminders, defaultRemindersFor(draft.window)) ? null : draft.reminders;
    const existing = draft.id ? tasks.find((t) => t.id === draft.id) : undefined;
    const task: Task = {
      id: draft.id ?? newId(),
      name: draft.name.trim(),
      icon: draft.icon.trim() || '✅',
      cadence: draft.cadence,
      window: draft.window,
      weight: draft.weight,
      active: true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...(custom ? { reminders: custom } : {}),
    };
    await store.saveTask(task);
    setDraft(null);
  };

  const remove = async (t: Task) => {
    if (!window.confirm(`„${t.name}“ löschen? Die bisherige Historie bleibt erhalten.`)) return;
    await store.saveTask({ ...t, active: false });
  };

  return (
    <div className="pt-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Aufgaben</h1>
        {!draft && (
          <Button variant="secondary" onClick={() => setDraft(emptyDraft())}>
            + Neu
          </Button>
        )}
      </div>
      <p className="text-sm text-[var(--muted)]">Gewicht 1–3 = Aufwand. Schwerere Aufgaben zählen mehr bei der Fairness.</p>

      {draft && (
        <Card className="mt-4 p-4">
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-[1fr_4.5rem] gap-3">
              <Field label="Name">
                <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Bad putzen" />
              </Field>
              <Field label="Icon">
                <input className={`${inputClass} text-center text-xl`} value={draft.icon} maxLength={4} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rhythmus">
                <select
                  className={inputClass}
                  value={draft.cadence}
                  onChange={(e) => {
                    const cadence = e.target.value as Cadence;
                    const w = windowsFor(cadence)[0];
                    setDraft({ ...draft, cadence, window: w, reminders: defaultRemindersFor(w) });
                  }}
                >
                  <option value="weekly">wöchentlich</option>
                  <option value="monthly">monatlich</option>
                </select>
              </Field>
              <Field label="Zeitraum">
                <select className={inputClass} value={draft.window} onChange={(e) => {
                    const w = e.target.value as TaskWindow;
                    setDraft({ ...draft, window: w, reminders: defaultRemindersFor(w) });
                  }}>
                  {windowsFor(draft.cadence).map((w) => (
                    <option key={w} value={w}>
                      {WINDOW_LABEL[w]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Aufwand (Gewicht)">
              <select className={inputClass} value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })}>
                <option value={1}>1 – leicht</option>
                <option value={2}>2 – mittel</option>
                <option value={3}>3 – aufwendig</option>
              </select>
            </Field>
            <ReminderEditor window={draft.window} value={draft.reminders} onChange={(reminders) => setDraft({ ...draft, reminders })} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => { setDraft(null); setError(null); }}>
                Abbrechen
              </Button>
              <Button type="submit" className="flex-1">
                Speichern
              </Button>
            </div>
            {draft.id && (
              <button
                type="button"
                className="w-full pt-2 text-sm font-medium text-red-600"
                onClick={() => {
                  const t = tasks.find((x) => x.id === draft.id);
                  if (t) void remove(t).then(() => setDraft(null));
                }}
              >
                Aufgabe löschen
              </button>
            )}
          </form>
        </Card>
      )}

      <SectionTitle>Aktiv</SectionTitle>
      <ul className="space-y-2">
        {active.map((t) => (
          <li key={t.id}>
            <Card className="flex items-center gap-3 p-3">
              <span className="text-2xl" aria-hidden="true">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-[var(--muted)]">
                  {CADENCE_LABEL[t.cadence]} · {WINDOW_LABEL[t.window]} · Gewicht {t.weight}
                </div>
                <div className="text-xs text-[var(--muted)]" data-testid="reminder-summary">
                  {reminderSummary(t)}
                </div>
              </div>
              <button type="button" className="text-sm font-medium text-blue-600 dark:text-blue-400" onClick={() => edit(t)}>
                Bearbeiten
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Abschnitt "Erinnerungen" im Aufgaben-Formular. */
function ReminderEditor({
  window,
  value,
  onChange,
}: {
  window: TaskWindow;
  value: TaskReminders;
  onChange: (v: TaskReminders) => void;
}) {
  const days = allowedDays(window);
  const setSlot = (i: number, patch: Partial<TaskReminders['slots'][number]>) =>
    onChange({ ...value, slots: value.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <fieldset className="space-y-2 rounded-xl border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-medium text-[var(--muted)]">Erinnerungen</legend>
      <Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label="Erinnerungen an" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.withButtons} onChange={(e) => onChange({ ...value, withButtons: e.target.checked })} />
        Mit Knöpfen ✓ Erledigt / Noch nicht
      </label>
      <ul className={`space-y-2 ${value.enabled ? '' : 'opacity-50'}`}>
        {value.slots.map((slot, i) => (
          <li key={i} className="flex items-center gap-2" data-testid="reminder-slot">
            <select
              aria-label="Tag"
              className={`${inputClass.replace('w-full ', '')} min-w-0 flex-1`}
              value={slot.day}
              onChange={(e) => setSlot(i, { day: Number(e.target.value) })}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(window, d)}
                </option>
              ))}
            </select>
            <input
              aria-label="Uhrzeit"
              type="time"
              className={`${inputClass.replace('w-full ', '')} w-32 shrink-0`}
              value={slot.time}
              onChange={(e) => setSlot(i, { time: e.target.value })}
            />
            <button
              type="button"
              aria-label="Erinnerung entfernen"
              className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-neutral-100 dark:hover:bg-neutral-800"
              onClick={() => onChange({ ...value, slots: value.slots.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          className="font-medium text-blue-600 dark:text-blue-400"
          onClick={() => onChange({ ...value, slots: [...value.slots, { day: days[0], time: '17:00' }] })}
        >
          + Erinnerung hinzufügen
        </button>
        <button type="button" className="font-medium text-blue-600 dark:text-blue-400" onClick={() => onChange(defaultRemindersFor(window))}>
          Standard wiederherstellen
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">Uhrzeiten in irischer Zeit. Nachrichten kommen bis zu ca. 15 Minuten später.</p>
    </fieldset>
  );
}
