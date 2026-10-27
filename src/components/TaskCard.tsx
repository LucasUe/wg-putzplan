import { useState } from 'react';
import { Badge, Button, MemberDot } from './ui';
import { completionId, taskStatus, useApp } from '../lib/AppContext';
import { formatCountdown, formatRange, rangeEnd, windowFor, type Period } from '../lib/periods';
import type { TaskAssignment } from '../lib/schedule';
import type { Task } from '../lib/types';

interface Props {
  period: Period;
  task: Task;
  assignment: TaskAssignment | undefined;
}

export function TaskCard({ period, task, assignment }: Props) {
  const { now, memberById, completionById, toggleCompletion, currentMember } = useApp();
  const [busy, setBusy] = useState(false);

  const range = windowFor(period, task.window);
  const end = rangeEnd(range);
  const id = completionId(period.key, task.id);
  const completion = completionById.get(id);
  const done = Boolean(completion);
  const status = taskStatus(end, done, now);
  const owner = assignment?.memberId ? memberById.get(assignment.memberId) : undefined;
  const absentNames = (assignment?.absentMemberIds ?? [])
    .map((mid) => memberById.get(mid)?.name)
    .filter((n): n is string => Boolean(n));
  const doneBy = completion ? memberById.get(completion.doneBy)?.name : undefined;

  const toggle = async () => {
    setBusy(true);
    try {
      await toggleCompletion(period.key, task.id);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge =
    status === 'erledigt' ? (
      <Badge tone="ok">erledigt{doneBy ? ` von ${doneBy}` : ''}</Badge>
    ) : status === 'überfällig' ? (
      <Badge tone="danger">überfällig</Badge>
    ) : (
      <Badge>{formatCountdown(now, end)}</Badge>
    );

  return (
    <article
      className={`rounded-2xl border border-[var(--border)] border-l-4 bg-[var(--surface)] p-4 shadow-sm transition ${
        status === 'überfällig' ? 'ring-2 ring-red-400/70' : ''
      } ${status === 'erledigt' ? 'opacity-60' : ''}`}
      style={{ borderLeftColor: owner?.color ?? '#9CA3AF' }}
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl leading-none" aria-hidden="true">
          {task.icon}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className={`font-semibold leading-tight ${status === 'erledigt' ? 'line-through' : ''}`}>{task.name}</h3>
          <div className="flex items-center gap-2 text-sm">
            {owner ? (
              <>
                <MemberDot color={owner.color} />
                <span className="font-medium">{owner.name}</span>
              </>
            ) : (
              <span className="text-[var(--muted)]">niemand verfügbar</span>
            )}
          </div>
          <div className="text-xs text-[var(--muted)]">{formatRange(range)}</div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {statusBadge}
            {assignment?.reassigned && (
              <Badge tone="warn">
                übernommen wegen Abwesenheit{absentNames.length ? ` von ${absentNames.join(' und ')}` : ''}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant={done ? 'secondary' : 'primary'}
          disabled={busy || !currentMember}
          onClick={toggle}
          aria-pressed={done}
        >
          {done ? 'Rückgängig' : 'Abhaken ✓'}
        </Button>
      </div>
    </article>
  );
}
