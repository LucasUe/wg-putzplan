import { ConfirmDialog } from '../components/ConfirmDialog';
import { TaskCard } from '../components/TaskCard';
import { SectionTitle, Toggle } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { periodTitle, type Period } from '../lib/periods';
import type { PeriodSchedule } from '../lib/schedule';

export function Overview() {
  const { currentWeekly, currentMonthly, taskById, onlyMine, setOnlyMine, currentMember } = useApp();

  const render = (ps: PeriodSchedule | undefined, label: string) => {
    if (!ps) return null;
    const period: Period = ps.period;
    const rows = ps.assignments
      .filter((a) => taskById.has(a.taskId))
      .filter((a) => !onlyMine || (currentMember !== undefined && a.memberId === currentMember.id));
    return (
      <section>
        <SectionTitle aside={periodTitle(period)}>{label}</SectionTitle>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
            Nichts für dich in diesem Zeitraum.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((a) => (
              <TaskCard key={`${period.key}-${a.taskId}`} period={period} task={taskById.get(a.taskId)!} assignment={a} />
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-2 pt-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Übersicht</h1>
          {currentMember && <p className="text-sm text-[var(--muted)]">Hallo {currentMember.name}</p>}
        </div>
      </header>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-1">
        <Toggle checked={onlyMine} onChange={setOnlyMine} label="Nur ich" />
      </div>
      {render(currentWeekly, 'Diese Woche')}
      {render(currentMonthly, 'Dieser Monat')}
      <ConfirmDialog />
    </div>
  );
}
