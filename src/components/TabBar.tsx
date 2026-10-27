import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/overview', label: 'Übersicht', icon: '🏠' },
  { to: '/plan', label: 'Plan', icon: '📅' },
  { to: '/absences', label: 'Abwesend', icon: '🌴' },
  { to: '/tasks', label: 'Aufgaben', icon: '🧽' },
  { to: '/more', label: 'Mehr', icon: '⋯' },
];

export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md justify-around">
        {TABS.map((t) => (
          <li key={t.to} className="flex-1">
            <NavLink
              to={t.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive ? 'text-blue-600 dark:text-blue-400' : 'text-[var(--muted)]'
                }`
              }
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {t.icon}
              </span>
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
