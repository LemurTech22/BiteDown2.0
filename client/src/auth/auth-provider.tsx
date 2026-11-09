import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { isApiError, useApi } from '@/api';
import type { User } from '@/api/types';
import { tokenStore } from '@/auth/token-store';

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

  const restoreSession = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const token = await tokenStore.get();
      if (!token) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      const response = await api.me();
      setUser(response.user);
      setStatus('authenticated');
    } catch (cause) {
      setUser(null);
      if (isApiError(cause) && cause.status === 401) {
        await tokenStore.set(null);
        setStatus('unauthenticated');
      } else {
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
    };
  }, [restoreSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: sessionExpired ? 'unauthenticated' : status,
      user: sessionExpired ? null : user,
      error,
      login: async (input) => {
        const response = await api.login(input);
        setUser(response.user);
        setStatus('authenticated');
        clearSessionExpired();
      },
      signup: async (input) => {
        const response = await api.signup(input);
        setUser(response.user);
        setStatus('authenticated');
        clearSessionExpired();
      },
      retry: restoreSession,
      signOut: async () => {
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
