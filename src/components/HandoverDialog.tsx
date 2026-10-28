import { useState } from 'react';
import { Button, MemberDot } from './ui';
import { completionId, useApp } from '../lib/AppContext';

interface Props {
  periodKey: string;
  taskId: string;
  onClose: () => void;
}

/** Eigene Aufgabe an eine verfügbare Person abgeben oder mit ihr tauschen. */
export function HandoverDialog({ periodKey, taskId, onClose }: Props) {
  const { findAssignment, taskById, memberById, currentMember, completionById, handOver } = useApp();
  const [to, setTo] = useState<string | null>(null);
  const [swapPick, setSwapPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = findAssignment(periodKey, taskId);
  const task = taskById.get(taskId);
  if (!found || !task || !currentMember) return null;
  const me = currentMember.id;
  const candidates = found.a.eligible.filter((id) => id !== me && memberById.has(id));
  const recipient = to ? memberById.get(to) : undefined;

  // Tauschkandidaten: Aufgaben des Empfängers in dieser Periode, noch offen, für die ich verfügbar bin
  const swapOptions = to
    ? found.ps.assignments.filter(
        (x) =>
          x.taskId !== taskId &&
          x.memberId === to &&
          taskById.has(x.taskId) &&
          !completionById.has(completionId(periodKey, x.taskId)) &&
          x.eligible.includes(me),
      )
    : [];
  const swapTaskId = swapPick && swapOptions.some((x) => x.taskId === swapPick) ? swapPick : swapOptions[0]?.taskId;
  const swapTask = swapTaskId ? taskById.get(swapTaskId) : undefined;

  const submit = async (withSwap: boolean) => {
    if (!to) return;
    setBusy(true);
    setError(null);
    try {
      await handOver(periodKey, taskId, to, withSwap ? swapTaskId : undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Abgeben fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold">
          {task.icon} {task.name} abgeben
        </h2>

        {!recipient ? (
          <>
            <p className="mb-2 text-sm font-medium">An wen?</p>
            {candidates.length === 0 ? (
              <p className="mb-4 text-sm text-[var(--muted)]">Niemand sonst ist in diesem Zeitraum verfügbar.</p>
            ) : (
              <div className="mb-4 grid gap-2">
                {candidates.map((id) => {
                  const m = memberById.get(id)!;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTo(id)}
                      className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-left font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      <MemberDot color={m.color} />
                      {m.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Button variant="secondary" className="w-full" onClick={onClose}>
              Abbrechen
            </Button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium">Sollen die anderen Aufgaben angepasst werden?</p>

            <div className="mb-3 rounded-xl border border-[var(--border)] p-3">
              {swapOptions.length > 1 && (
                <div className="mb-2 space-y-1">
                  {swapOptions.map((x) => {
                    const t = taskById.get(x.taskId)!;
                    return (
                      <label key={x.taskId} className="flex items-center gap-2 text-sm">
                        <input type="radio" name="swap" checked={swapTaskId === x.taskId} onChange={() => setSwapPick(x.taskId)} />
                        {t.icon} {t.name}
                      </label>
                    );
                  })}
                </div>
              )}
              <Button className="w-full" disabled={busy || !swapTask} onClick={() => submit(true)}>
                Ja, tauschen
              </Button>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {swapTask
                  ? `Ihr tauscht: Du machst ${swapTask.name}, ${recipient.name} macht ${task.name}.`
                  : `Kein Tausch möglich – ${recipient.name} hat in dieser Woche keine Aufgabe, die du übernehmen kannst.`}
              </p>
            </div>

            <div className="mb-3 rounded-xl border border-[var(--border)] p-3">
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => submit(false)}>
                Nein, nur abgeben
              </Button>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {recipient.name} hat dann eine Aufgabe mehr. Das wird nicht ausgeglichen.
              </p>
            </div>

            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <Button variant="secondary" className="w-full" disabled={busy} onClick={onClose}>
              Abbrechen
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
