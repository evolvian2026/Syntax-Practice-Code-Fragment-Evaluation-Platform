import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorNote } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const DEMO_ACCOUNTS = [
  { label: 'Student', email: 'student@syntaxpractice.dev', password: 'student123' },
  { label: 'Admin', email: 'admin@syntaxpractice.dev', password: 'admin123' },
];

export function Login() {
  const { user, login, register, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/practice" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register({ email, password, fullName });
      navigate('/practice');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword(account.password);
    setBusy(true);
    setError(null);
    try {
      await login(account.email, account.password);
      navigate('/practice');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demo sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink-950 p-10 text-slate-200 lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm">{'</>'}</span>
          Syntax Practice
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Write only the part you are learning.
          </h1>
          <p className="mt-4 text-slate-400">
            Practise the individual constructs that make up real programs — a JOIN clause, a
            <code className="mx-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-sm">for</code> loop,
            a condition — and get graded on whether you used the right one, not just on the output.
          </p>
          <div className="mt-8 space-y-3 font-mono text-sm">
            <div className="rounded-lg border border-ink-800 bg-ink-900 p-3">
              <p className="text-slate-500">numbers = [1, 2, 3, 4, 5]</p>
              <p className="my-2 rounded border border-dashed border-brand-500/60 bg-ink-950 p-2 text-brand-300">
                for n in numbers:
                <br />
                {'    '}print(n)
              </p>
              <p className="text-slate-500">print("Done")</p>
            </div>
            <p className="text-xs text-slate-500">The platform supplies everything outside the dashed box.</p>
          </div>
        </div>
        <p className="text-xs text-slate-600">Python · SQL · Java · C · C++ · JavaScript · HTML · CSS</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm text-white">{'</>'}</span>
              Syntax Practice
            </div>
          </div>

          <h2 className="text-xl font-semibold">
            {mode === 'login' ? 'Sign in to practise' : 'Create your account'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login'
              ? 'Pick up where you left off.'
              : 'Track your streak, badges and topic-wise accuracy.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label" htmlFor="fullName">Full name</label>
                <input
                  id="fullName" className="input" value={fullName} required minLength={2}
                  onChange={(e) => setFullName(e.target.value)} autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email" type="email" className="input" value={email} required
                onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password" type="password" className="input" value={password} required minLength={6}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {error && <ErrorNote message={error} />}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="link"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          <div className="mt-8 border-t border-slate-200 pt-4 dark:border-ink-800">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</p>
            <div className="flex gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="btn-secondary flex-1 text-xs"
                  onClick={() => useDemo(account)}
                  disabled={busy}
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
