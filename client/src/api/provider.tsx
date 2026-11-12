import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { tokenStore } from '@/auth/token-store';
import { deviceStore } from '@/storage/key-value-store';

import { API_CONFIG_URL, DEFAULT_API_BASE_URL, DEFAULT_DEMO_MODE, fetchRemoteApiBaseUrl, normalizeBaseUrl, normalizeRemoteBaseUrl } from './config';
import { LiveApiClient } from './live-client';
import { MockApiClient } from './mock-client';
import type { ApiClient } from './types';

const BASE_URL_KEY = 'settings.apiBaseUrl';
const REMOTE_BASE_URL_KEY = 'settings.remoteApiBaseUrl';
const DEMO_MODE_KEY = 'settings.demoMode';
const REMOTE_REFRESH_MS = 60_000;

export type BaseUrlSource = 'custom' | 'remote' | 'default';

interface ApiContextValue {
  api: ApiClient;
  baseUrl: string;
  baseUrlSource: BaseUrlSource;
  demoMode: boolean;
  sessionExpired: boolean;
  setBaseUrl: (value: string) => Promise<void>;
  clearBaseUrl: () => Promise<void>;
  setDemoMode: (value: boolean) => Promise<void>;
  clearSessionExpired: () => void;
  signOut: () => Promise<void>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const [customBaseUrl, setCustomBaseUrl] = useState<string | null>(null);
  const [remoteBaseUrl, setRemoteBaseUrl] = useState<string | null>(null);
  const baseUrl = customBaseUrl ?? remoteBaseUrl ?? DEFAULT_API_BASE_URL;
  const baseUrlSource: BaseUrlSource = customBaseUrl !== null ? 'custom' : remoteBaseUrl !== null ? 'remote' : 'default';
  const [demoMode, setDemoModeState] = useState(DEFAULT_DEMO_MODE);
  const [sessionExpired, setSessionExpired] = useState(false);
  const loading = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    loading.current = Promise.all([
      deviceStore.get(BASE_URL_KEY).catch(() => null),
      deviceStore.get(DEMO_MODE_KEY).catch(() => null),
      deviceStore.get(REMOTE_BASE_URL_KEY).catch(() => null),
    ]).then(
      ([storedBaseUrl, storedDemoMode, storedRemoteBaseUrl]) => {
        if (!active) return;
        if (storedBaseUrl) {
          try { setCustomBaseUrl(normalizeBaseUrl(storedBaseUrl)); } catch { /* Ignore invalid saved addresses. */ }
        }
        setRemoteBaseUrl(normalizeRemoteBaseUrl(storedRemoteBaseUrl));
        if (storedDemoMode !== null) setDemoModeState(storedDemoMode === 'true');
      },
    );

    if (!API_CONFIG_URL) return () => { active = false; };

    let lastFetchAt = -Infinity;
    let fetching = false;
    async function refreshRemoteConfig() {
      await loading.current;
      if (!active || fetching || Date.now() - lastFetchAt < REMOTE_REFRESH_MS) return;
      lastFetchAt = Date.now();
      fetching = true;
      try {
        const next = await fetchRemoteApiBaseUrl();
        if (!active || next === null) return;
        setRemoteBaseUrl(next);
        await deviceStore.set(REMOTE_BASE_URL_KEY, next);
      } catch {
        // A cache write failure must not discard a valid server config.
      } finally {
        fetching = false;
      }
    }
    void refreshRemoteConfig();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRemoteConfig();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const api = useMemo<ApiClient>(() => {
    if (client) return client;
    if (demoMode) return new MockApiClient();
    return new LiveApiClient({
      getBaseUrl: () => baseUrl,
      getToken: tokenStore.get,
      setToken: tokenStore.set,
      onSessionExpired: () => setSessionExpired(true),
    });
  }, [baseUrl, client, demoMode]);

  const value = useMemo<ApiContextValue>(
    () => ({
      api,
      baseUrl,
      baseUrlSource,
      demoMode,
      sessionExpired,
      setBaseUrl: async (next) => {
        const normalized = normalizeBaseUrl(next);
        await loading.current;
        await deviceStore.set(BASE_URL_KEY, normalized);
        setCustomBaseUrl(normalized);
      },
      clearBaseUrl: async () => {
        await loading.current;
        await deviceStore.delete(BASE_URL_KEY);
        setCustomBaseUrl(null);
      },
      setDemoMode: async (next) => {
        await loading.current;
        await deviceStore.set(DEMO_MODE_KEY, String(next));
        setDemoModeState(next);
      },
      clearSessionExpired: () => setSessionExpired(false),
      signOut: async () => {
        await tokenStore.set(null);
        setSessionExpired(false);
      },
    }),
    [api, baseUrl, baseUrlSource, demoMode, sessionExpired],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside ApiProvider.');
  return value;
}
