import { useState } from 'react';
import { Button, Card, Field, SectionTitle, inputClass } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { newId } from '../lib/crypto';
import type { Cadence, TaskWindow } from '../lib/periods';
import type { Task } from '../lib/types';

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
}

const emptyDraft = (): Draft => ({ id: null, name: '', icon: '🧹', cadence: 'weekly', window: 'weekend', weight: 1 });

export function Tasks() {
  const { tasks, store } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = tasks.filter((t) => t.active).sort((a, b) => a.cadence.localeCompare(b.cadence) || a.name.localeCompare(b.name, 'de'));

  const windowsFor = (c: Cadence): TaskWindow[] => (c === 'weekly' ? ['weekend', 'fullWeek'] : ['fullMonth']);

  const edit = (t: Task) =>
    setDraft({ id: t.id, name: t.name, icon: t.icon, cadence: t.cadence, window: t.window, weight: t.weight });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) return setError('Bitte einen Namen eingeben.');
    setError(null);
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
                    setDraft({ ...draft, cadence, window: windowsFor(cadence)[0] });
                  }}
                >
                  <option value="weekly">wöchentlich</option>
                  <option value="monthly">monatlich</option>
                </select>
              </Field>
              <Field label="Zeitraum">
                <select className={inputClass} value={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.value as TaskWindow })}>
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
