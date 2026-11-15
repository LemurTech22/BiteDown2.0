import { router } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { isApiError, useApi } from '@/api';
import type { User } from '@/api/types';
import { tokenStore } from '@/auth/token-store';
import { reportServerError } from '@/components/server-error';

interface Credentials {
  email: string;
  password: string;
}

interface SignupInput extends Credentials {
  display_name: string;
}

interface AuthContextValue {
  status: 'loading' | 'unauthenticated' | 'authenticated' | 'error';
  user: User | null;
  error: string | null;
  login: (input: Credentials) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  retry: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { api, clearSessionExpired, sessionExpired, signOut: clearApiSession } = useApi();
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (sessionExpired) router.replace('/');
  }, [sessionExpired]);

  const restoreSession = useCallback(async () => {
    const current = ++generation.current;
    setStatus('loading');
    setError(null);
    try {
      const token = await tokenStore.get();
      if (current !== generation.current) return;
      if (!token) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      const response = await api.me();
      if (current !== generation.current) return;
      setUser(response.user);
      setStatus('authenticated');
    } catch (cause) {
      if (current !== generation.current) return;
      setUser(null);
      if (isApiError(cause) && cause.status === 401) {
        await tokenStore.set(null);
        setStatus('unauthenticated');
      } else {
        reportServerError(cause);
        setError(cause instanceof Error ? cause.message : 'We couldn’t restore your session. Try again.');
        setStatus('error');
      }
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return restoreSession();
    });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [restoreSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: sessionExpired ? 'unauthenticated' : status,
      user: sessionExpired ? null : user,
      error,
      login: async (input) => {
        generation.current += 1;
        const response = await api.login(input).catch((cause: unknown) => {
          reportServerError(cause);
          throw cause;
        });
        setUser(response.user);
        setStatus('authenticated');
        clearSessionExpired();
      },
      signup: async (input) => {
        generation.current += 1;
        const response = await api.signup(input).catch((cause: unknown) => {
          reportServerError(cause);
          throw cause;
        });
        setUser(response.user);
        setStatus('authenticated');
        clearSessionExpired();
      },
      retry: restoreSession,
      signOut: async () => {
        generation.current += 1;
        await clearApiSession();
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [api, clearApiSession, clearSessionExpired, error, restoreSession, sessionExpired, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
