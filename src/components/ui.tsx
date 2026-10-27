import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm ${className}`}>{children}</div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-end justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{children}</h2>
      {aside && <div className="text-xs text-[var(--muted)]">{aside}</div>}
    </div>
  );
}

export function MemberDot({ color, className = '' }: { color: string; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`} style={{ backgroundColor: color }} />;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'ok' }) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
    warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md';
}) {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
    secondary: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-neutral-100 dark:hover:bg-neutral-800',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40',
    outline: 'border border-blue-600 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-950/40',
  } as const;
  const sizes = {
    md: 'px-4 py-2.5 text-sm',
    sm: 'px-3 py-1.5 text-sm',
  } as const;
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="text-sm font-medium">{label}</span>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-neutral-300 transition peer-checked:bg-blue-600 dark:bg-neutral-700" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export function DemoBanner() {
  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200">
      <strong>Demo-Modus:</strong> Daten bleiben nur in diesem Browser. Für den gemeinsamen Betrieb Firebase einrichten (siehe SETUP.md).
    </div>
  );
}
