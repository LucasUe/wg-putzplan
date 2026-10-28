import { useState } from 'react';
import { HandoverDialog } from '../components/HandoverDialog';
import { Badge, Card, MemberDot, SectionTitle } from '../components/ui';
import { completionId, useApp } from '../lib/AppContext';
import { berlinDay, formatRange, periodTitle, windowFor, type Period } from '../lib/periods';
import { reassignBadge, type PeriodSchedule } from '../lib/schedule';

export function Plan() {
  const { schedule, today, taskById, memberById, onlyMine, currentMember, completionById, overrideById, revokeOverride } = useApp();
  const [handover, setHandover] = useState<{ periodKey: string; taskId: string } | null>(null);
  const isDone = (periodKey: string, taskId: string) => completionById.has(completionId(periodKey, taskId));

  const upcoming = (list: PeriodSchedule[], n: number) => list.filter((p) => p.period.endDay >= today).slice(0, n);

  const block = (ps: PeriodSchedule, title: string) => {
    const period: Period = ps.period;
    const rows = ps.assignments
      .filter((a) => taskById.has(a.taskId))
      .filter((a) => !onlyMine || (currentMember !== undefined && a.memberId === currentMember.id));
    if (rows.length === 0) return null;
    return (
      <Card key={period.key} className="mb-3 p-4">
        <div className="mb-2">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-[var(--muted)]">{formatRange(period)}</div>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((a) => {
            const t = taskById.get(a.taskId)!;
            const owner = a.memberId ? memberById.get(a.memberId) : undefined;
            const badge = reassignBadge(a, (id) => memberById.get(id)?.name ?? id);
            const done = isDone(period.key, a.taskId);
            const mine = currentMember !== undefined && a.memberId === currentMember.id;
            const ov = overrideById.get(completionId(period.key, a.taskId));
            const canRevoke =
              a.overrideKind !== null &&
              ov !== undefined &&
              ov.createdBy === currentMember?.id &&
              ov.memberId !== currentMember?.id &&
              !done &&
              !(ov.partnerTaskId && isDone(period.key, ov.partnerTaskId));
            return (
              <li key={a.taskId} className="flex items-center gap-3 py-2">
                <span className="text-xl" aria-hidden="true">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {formatRange(windowFor(period, t.window))}
                  </div>
                  {badge && (
                    <div className="mt-1">
                      <Badge tone="warn">{badge}</Badge>
                    </div>
                  )}
                  {canRevoke && (
                    <button
                      type="button"
                      className="mt-1 block text-xs font-medium text-blue-600 dark:text-blue-400"
                      onClick={() => void revokeOverride(period.key, a.taskId)}
                    >
                      Abgabe zurücknehmen
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-sm">
                  {owner ? (
                    <>
                      <MemberDot color={owner.color} />
                      <span>{owner.name}</span>
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">frei</span>
                  )}
                  {mine && !done && (
                    <button
                      type="button"
                      className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      onClick={() => setHandover({ periodKey: period.key, taskId: a.taskId })}
                    >
                      Abgeben
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  };

  const weeks = upcoming(schedule.weekly, 5);
  const months = upcoming(schedule.monthly, 3);

  return (
    <div className="pt-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Plan</h1>
      <p className="text-sm text-[var(--muted)]">Nächste 5 Wochen und 3 Monate. Stand: {berlinDay(new Date())}</p>

      <SectionTitle>Wochen</SectionTitle>
      {weeks.map((ps) => block(ps, periodTitle(ps.period)))}

      <SectionTitle>Monate</SectionTitle>
      {months.map((ps) => block(ps, periodTitle(ps.period)))}

      {handover && <HandoverDialog periodKey={handover.periodKey} taskId={handover.taskId} onClose={() => setHandover(null)} />}
    </div>
  );
}
