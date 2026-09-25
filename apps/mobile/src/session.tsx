import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from './config';
import { createApiClient, type ApiClient } from './lib/api-client';
import { PendingAnswerQueue } from './lib/pending-answers';
import { secureStorage } from './secure-storage';
import { ADULT_SESSION_KEY, supabase } from './supabase';

const CHILD_TOKEN_KEY = 'imc.child.token';
const CHILD_ID_KEY = 'imc.child.student';
const DEV_ADULT_KEY = 'imc.adult.devToken';

export type Mode = 'loading' | 'signedOut' | 'adult' | 'child';

interface SessionState {
  mode: Mode;
  studentId: string | null;
  api: ApiClient;
  pending: PendingAnswerQueue | null;
  /** Adult: request an email OTP. */
  sendOtp(email: string): Promise<void>;
  /** Adult: verify the OTP (also used for fresh re-authentication before sensitive actions). */
  verifyOtp(email: string, code: string): Promise<void>;
  devSignIn(token: string): Promise<void>;
  /** Parent hands the device to a child: stores the child token and clears adult credentials. */
  enterChildMode(studentId: string, childToken: string): Promise<void>;
  /** Leaving child mode always requires a new adult sign-in. */
  leaveChildMode(): Promise<void>;
  signOut(): Promise<void>;
  newIdempotencyKey(): string;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [studentId, setStudentId] = useState<string | null>(null);
  const childToken = useRef<string | null>(null);
  const devAdult = useRef<string | null>(null);

  const clearChildCache = useCallback(async (sid: string | null) => {
    if (sid) await new PendingAnswerQueue(AsyncStorage, sid).clear();
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('imc.cache.')));
  }, []);

  const signOutLocal = useCallback(async () => {
    const sid = studentId;
    childToken.current = null;
    devAdult.current = null;
    await secureStorage.removeItem(CHILD_TOKEN_KEY);
    await secureStorage.removeItem(CHILD_ID_KEY);
    await secureStorage.removeItem(DEV_ADULT_KEY);
    if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    await secureStorage.removeItem(ADULT_SESSION_KEY);
    await clearChildCache(sid);
    setStudentId(null);
    setMode('signedOut');
  }, [studentId, clearChildCache]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: async () => {
          if (childToken.current) return childToken.current;
          if (devAdult.current) return devAdult.current;
          const s = supabase ? (await supabase.auth.getSession()).data.session : null;
          return s?.access_token ?? null;
        },
        // Expired/revoked sessions require parent sign-in; no offline access is invented.
        onUnauthenticated: () => void signOutLocal(),
      }),
    [signOutLocal],
  );

  useEffect(() => {
    void (async () => {
      const token = await secureStorage.getItem(CHILD_TOKEN_KEY);
      const sid = await secureStorage.getItem(CHILD_ID_KEY);
      if (token && sid) {
        childToken.current = token;
        setStudentId(sid);
        setMode('child');
        return;
      }
      devAdult.current = await secureStorage.getItem(DEV_ADULT_KEY);
      const s = supabase ? (await supabase.auth.getSession()).data.session : null;
      setMode(devAdult.current || s ? 'adult' : 'signedOut');
    })();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      mode,
      studentId,
      api,
      pending:
        mode === 'child' && studentId ? new PendingAnswerQueue(AsyncStorage, studentId) : null,
      async sendOtp(email) {
        if (!supabase) throw new Error('Email sign-in is not configured for this build.');
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
      },
      async verifyOtp(email, code) {
        if (!supabase) throw new Error('Email sign-in is not configured for this build.');
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw error;
        setMode('adult');
      },
      async devSignIn(token) {
        devAdult.current = token.trim();
        await secureStorage.setItem(DEV_ADULT_KEY, devAdult.current);
        setMode('adult');
      },
      async enterChildMode(sid, token) {
        // Clear persisted adult access/refresh credentials from this device first.
        devAdult.current = null;
        await secureStorage.removeItem(DEV_ADULT_KEY);
        if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        await secureStorage.removeItem(ADULT_SESSION_KEY);
        await secureStorage.setItem(CHILD_TOKEN_KEY, token);
        await secureStorage.setItem(CHILD_ID_KEY, sid);
        childToken.current = token;
        setStudentId(sid);
        setMode('child');
      },
      async leaveChildMode() {
        await signOutLocal();
      },
      signOut: signOutLocal,
      newIdempotencyKey: () => Crypto.randomUUID(),
    }),
    [mode, studentId, api, signOutLocal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
