import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { tokenStore } from '@/auth/token-store';
import { deviceStore } from '@/storage/key-value-store';

import { DEFAULT_API_BASE_URL, DEFAULT_DEMO_MODE, normalizeBaseUrl } from './config';
import { LiveApiClient } from './live-client';
import { MockApiClient } from './mock-client';
import type { ApiClient } from './types';

const BASE_URL_KEY = 'settings.apiBaseUrl';
const DEMO_MODE_KEY = 'settings.demoMode';

interface ApiContextValue {
  api: ApiClient;
  baseUrl: string;
  demoMode: boolean;
  sessionExpired: boolean;
  setBaseUrl: (value: string) => Promise<void>;
  setDemoMode: (value: boolean) => Promise<void>;
  clearSessionExpired: () => void;
  signOut: () => Promise<void>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_API_BASE_URL);
  const [demoMode, setDemoModeState] = useState(DEFAULT_DEMO_MODE);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([deviceStore.get(BASE_URL_KEY), deviceStore.get(DEMO_MODE_KEY)]).then(
      ([storedBaseUrl, storedDemoMode]) => {
        if (!active) return;
        if (storedBaseUrl) setBaseUrlState(storedBaseUrl);
        if (storedDemoMode !== null) setDemoModeState(storedDemoMode === 'true');
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const api = useMemo<ApiClient>(() => {
    if (demoMode) return new MockApiClient();
    return new LiveApiClient({
      getBaseUrl: () => baseUrl,
      getToken: tokenStore.get,
      setToken: tokenStore.set,
      onSessionExpired: () => setSessionExpired(true),
    });
  }, [baseUrl, demoMode]);

  const value = useMemo<ApiContextValue>(
    () => ({
      api,
      baseUrl,
      demoMode,
      sessionExpired,
      setBaseUrl: async (next) => {
        const normalized = normalizeBaseUrl(next);
        await deviceStore.set(BASE_URL_KEY, normalized);
        setBaseUrlState(normalized);
      },
      setDemoMode: async (next) => {
        await deviceStore.set(DEMO_MODE_KEY, String(next));
        setDemoModeState(next);
      },
      clearSessionExpired: () => setSessionExpired(false),
      signOut: async () => {
        await tokenStore.set(null);
        setSessionExpired(false);
      },
    }),
    [api, baseUrl, demoMode, sessionExpired],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside ApiProvider.');
  return value;
}
