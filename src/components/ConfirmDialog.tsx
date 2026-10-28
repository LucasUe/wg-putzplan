import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from './ui';
import { completionId, useApp } from '../lib/AppContext';

/**
 * Rückfrage nach Klick auf eine Erinnerung (z. B. iPhone, dort gibt es keine Buttons in der Nachricht).
 * Erwartet im Hash `#/overview?confirm=<periodKey>|<taskId>`.
 */
export function ConfirmDialog() {
  const location = useLocation();
  const navigate = useNavigate();
  const { taskById, completionById, toggleCompletion, findAssignment, currentMember } = useApp();
  const [busy, setBusy] = useState(false);

  const raw = new URLSearchParams(location.search).get('confirm');
  const [periodKey = '', taskId = ''] = raw ? raw.split('|') : [];
  const close = useCallback(() => navigate(location.pathname, { replace: true }), [navigate, location.pathname]);

  const task = taskById.get(taskId);
  // Nur eigene Aufgaben dürfen abgehakt werden
  const known = Boolean(currentMember) && findAssignment(periodKey, taskId)?.a.memberId === currentMember?.id;
  const open = Boolean(raw && task && known && !completionById.has(completionId(periodKey, taskId)));

  // Schon erledigt oder unbekannt: Parameter still entfernen
  useEffect(() => {
    if (raw && !open && !busy) close();
  }, [raw, open, busy, close]);

  if (!open || !task) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await toggleCompletion(periodKey, taskId);
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
        <div className="mb-1 text-4xl" aria-hidden="true">
          {task.icon}
        </div>
        <h2 className="mb-4 text-lg font-semibold">
          Hast du {task.icon} {task.name} erledigt?
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>
            Noch nicht
          </Button>
          <Button className="flex-1" onClick={confirm} disabled={busy}>
            ✓ Ja, erledigt
          </Button>
        </div>
      </div>
    </div>
  );
}
