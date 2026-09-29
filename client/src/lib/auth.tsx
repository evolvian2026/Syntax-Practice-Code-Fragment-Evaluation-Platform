import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, getToken, setToken, type Profile, type User } from './api';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** Signed in, but the API could not be reached to confirm it. */
  unreachable: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; fullName: string }): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    setUnreachable(false);
    try {
      const me = await api.get<{ user: User; profile: Profile | null }>('/auth/me');
      setUser(me.user);
      setProfile(me.profile);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The server rejected the session — the one case that means it is
        // gone. The API wrapper has already discarded the token.
        setUser(null);
        setProfile(null);
      } else {
        // Anything else — the API restarting during a deploy, a dropped
        // connection, a request cut short by navigating away — says nothing
        // about the session. Discarding the token here logged every user out
        // whenever the API blinked, so it is kept and the page offers a retry.
        setUnreachable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onExpired = () => {
      setUser(null);
      setProfile(null);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    await refresh();
  }, [refresh]);

  const register = useCallback(async (input: { email: string; password: string; fullName: string }) => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', input);
    setToken(res.token);
    setUser(res.user);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user,
    profile,
    loading,
    unreachable,
    login,
    register,
    logout,
    refresh,
    isAdmin: user?.role === 'admin' || user?.role === 'teacher',
  }), [user, profile, loading, unreachable, login, register, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ------------------------------------------------------------------ theme

const THEME_KEY = 'syntax-practice.theme';

export function useTheme() {
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, setTheme: setThemeState, toggle };
}
