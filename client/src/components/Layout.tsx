import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/** §28 — the shell: top nav, user menu, theme toggle, responsive drawer. */

interface Props {
  theme: 'dark' | 'light';
  onToggleTheme(): void;
}

const AVATAR_COLORS: Record<string, string> = {
  indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  rose: 'bg-rose-500', sky: 'bg-sky-500', violet: 'bg-violet-500',
  teal: 'bg-teal-500', orange: 'bg-orange-500',
};

export function Layout({ theme, onToggleTheme }: Props) {
  const { user, profile, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const links = [
    { to: '/practice', label: 'Practice' },
    { to: '/learning-path', label: 'Learning path' },
    { to: '/assessments', label: 'Assessments' },
    { to: '/progress', label: 'Progress' },
    { to: '/mastery', label: 'Mastery' },
    { to: '/leaderboard', label: 'Leaderboard' },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
          <Link to="/practice" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-sm text-white">{'</>'}</span>
            <span className="hidden sm:inline">Syntax Practice</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-850'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-850'
                  }`
                }
              >
                Admin
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {profile && (
              <div className="hidden items-center gap-3 text-xs text-slate-500 dark:text-slate-400 xl:flex">
                <span title="Experience points" className="font-mono">⚡ {profile.xp} XP</span>
                <span title="Current streak" className="font-mono">🔥 {profile.streakCurrent}</span>
                <span title="Level" className="rounded-full bg-slate-100 px-2 py-0.5 font-medium dark:bg-ink-850">
                  Lv {profile.level}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={onToggleTheme}
              className="btn-ghost h-9 w-9 !px-0"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-ink-850"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-white ${AVATAR_COLORS[user?.avatarColor ?? 'indigo'] ?? 'bg-indigo-500'}`}>
                  {initials(user?.fullName ?? '?')}
                </span>
                <span className="hidden text-sm lg:inline">{user?.fullName}</span>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="card absolute right-0 z-20 mt-1 w-56 animate-fade-in p-1" role="menu">
                    <div className="border-b border-slate-200 px-3 py-2 dark:border-ink-800">
                      <p className="truncate text-sm font-medium">{user?.fullName}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">{user?.role}</p>
                    </div>
                    <MenuLink to="/progress" onClick={() => setMenuOpen(false)}>Progress &amp; badges</MenuLink>
                    <MenuLink to="/submissions" onClick={() => setMenuOpen(false)}>Submission history</MenuLink>
                    {isAdmin && <MenuLink to="/admin" onClick={() => setMenuOpen(false)}>Admin panel</MenuLink>}
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      onClick={() => { logout(); navigate('/login'); }}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              className="btn-ghost h-9 w-9 !px-0 lg:hidden"
              onClick={() => setNavOpen((o) => !o)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
          </div>
        </div>

        {navOpen && (
          <nav className="border-t border-slate-200 px-4 py-2 lg:hidden dark:border-ink-800">
            {[...links, ...(isAdmin ? [{ to: '/admin', label: 'Admin' }] : [])].map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-500 dark:border-ink-800 dark:text-slate-400">
        Syntax Practice — master one construct at a time.
      </footer>
    </div>
  );
}

function MenuLink({ to, children, onClick }: { to: string; children: React.ReactNode; onClick(): void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-ink-850"
      role="menuitem"
    >
      {children}
    </Link>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}
