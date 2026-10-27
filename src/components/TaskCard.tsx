import { useState } from 'react';
import { Badge, Button, MemberDot } from './ui';
import { completionId, taskStatus, useApp } from '../lib/AppContext';
import { formatCountdown, formatRange, rangeEnd, windowFor, type Period } from '../lib/periods';
import { reassignBadge, type TaskAssignment } from '../lib/schedule';
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
  const badgeText = assignment ? reassignBadge(assignment, (id) => memberById.get(id)?.name ?? id) : null;
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

  const isOwnTask = owner !== undefined && owner.id === currentMember?.id;
  const buttonVariant = done ? 'secondary' : isOwnTask || !owner ? 'primary' : 'outline';

  return (
    <article
      className={`rounded-2xl border border-[var(--border)] border-l-4 bg-[var(--surface)] p-3 shadow-sm transition ${
        status === 'überfällig' ? 'ring-2 ring-red-400/70' : ''
      } ${status === 'erledigt' ? 'opacity-60' : ''}`}
      style={{ borderLeftColor: owner?.color ?? '#9CA3AF' }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none" aria-hidden="true">
          {task.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`font-semibold leading-tight ${status === 'erledigt' ? 'line-through' : ''}`}>{task.name}</h3>
          <div className="flex items-center gap-1.5 text-sm">
            {owner ? (
              <>
                <MemberDot color={owner.color} />
                <span className="font-medium">{owner.name}</span>
              </>
            ) : (
              <span className="text-[var(--muted)]">niemand verfügbar</span>
            )}
            <span className="text-xs text-[var(--muted)]">· {formatRange(range)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {statusBadge}
          {badgeText && <Badge tone="warn">{badgeText}</Badge>}
        </div>
        <Button
          size="sm"
          variant={buttonVariant}
          disabled={busy || !currentMember}
          onClick={toggle}
          aria-pressed={done}
          className="shrink-0"
        >
          {done ? 'Rückgängig' : 'Abhaken ✓'}
        </Button>
      </div>
    </article>
  );
}
