import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setTokenProvider } from './api';

const DEV_TOKEN_KEY = 'imc.devToken';
export const devAuthEnabled =
  import.meta.env.VITE_DEV_AUTH === 'true' && import.meta.env.MODE !== 'production';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey && !supabaseKey.startsWith('replace-')
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: true, storage: window.sessionStorage },
      })
    : null;

export interface StaffUser {
  accountId: string;
  roles: string[];
}

interface AuthState {
  user: StaffUser | null;
  loading: boolean;
  error: string | null;
  supabaseAvailable: boolean;
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<void>;
  useDevToken(token: string): Promise<void>;
  signOut(): Promise<void>;
  hasRole(...roles: string[]): boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [devToken, setDevToken] = useState<string | null>(() =>
    devAuthEnabled ? window.sessionStorage.getItem(DEV_TOKEN_KEY) : null,
  );
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTokenProvider(async () => devToken ?? session?.access_token ?? null);
  }, [devToken, session]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const token = devToken ?? session?.access_token;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api<StaffUser>('GET', '/v1/admin/me')
      .then((u) => {
        setUser(u);
        setError(null);
      })
      .catch((e: Error) => {
        setUser(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [devToken, session]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      error,
      supabaseAvailable: supabase !== null,
      async sendOtp(email) {
        if (!supabase) throw new Error('Sign-in is not configured.');
        const { error: e } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });
        if (e) throw e;
      },
      async verifyOtp(email, code) {
        if (!supabase) throw new Error('Sign-in is not configured.');
        const { error: e } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (e) throw e;
      },
      async useDevToken(token) {
        if (!devAuthEnabled) throw new Error('Development sign-in is disabled.');
        window.sessionStorage.setItem(DEV_TOKEN_KEY, token.trim());
        setDevToken(token.trim());
      },
      async signOut() {
        window.sessionStorage.removeItem(DEV_TOKEN_KEY);
        setDevToken(null);
        if (supabase) await supabase.auth.signOut();
        setUser(null);
      },
      hasRole: (...roles) => !!user && roles.some((r) => user.roles.includes(r)),
    }),
    [user, loading, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
