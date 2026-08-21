import { NavLink, Outlet } from 'react-router-dom';

/** §19 — admin shell. */
export function AdminLayout() {
  const links = [
    { to: '/admin', label: 'Overview', end: true },
    { to: '/admin/questions', label: 'Questions' },
    { to: '/admin/assessments', label: 'Assessments' },
    { to: '/admin/students', label: 'Students' },
    { to: '/admin/analytics', label: 'Analytics' },
    { to: '/admin/import-export', label: 'Import / export' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-400">staff area</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-ink-800">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
