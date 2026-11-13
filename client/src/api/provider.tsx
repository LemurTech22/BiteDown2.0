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
const NETWORK_REFRESH_MS = 10_000;

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
  const baseUrls = useRef<{ custom: string | null; remote: string | null }>({ custom: null, remote: null });
  const refreshOnNetworkError = useRef<() => void>(() => {});
  const [readiness] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  });

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
          try {
            baseUrls.current.custom = normalizeBaseUrl(storedBaseUrl);
            setCustomBaseUrl(baseUrls.current.custom);
          } catch { /* Ignore invalid saved addresses. */ }
        }
        baseUrls.current.remote = normalizeRemoteBaseUrl(storedRemoteBaseUrl);
        setRemoteBaseUrl(baseUrls.current.remote);
        if (storedDemoMode !== null) setDemoModeState(storedDemoMode === 'true');
        if (!API_CONFIG_URL || baseUrls.current.remote) readiness.resolve();
      },
    );

    if (!API_CONFIG_URL) return () => { active = false; };

    let lastFetchAt = -Infinity;
    let fetching = false;
    async function refreshRemoteConfig(throttleMs = REMOTE_REFRESH_MS) {
      await loading.current;
      if (!active || fetching || Date.now() - lastFetchAt < throttleMs) return;
      lastFetchAt = Date.now();
      fetching = true;
      try {
        const next = await fetchRemoteApiBaseUrl();
        if (!active || next === null) return;
        baseUrls.current.remote = next;
        setRemoteBaseUrl(next);
        readiness.resolve();
        await deviceStore.set(REMOTE_BASE_URL_KEY, next);
      } catch {
        // A cache write failure must not discard a valid server config.
      } finally {
        fetching = false;
      }
    }
    void refreshRemoteConfig().finally(readiness.resolve);
    refreshOnNetworkError.current = () => { void refreshRemoteConfig(NETWORK_REFRESH_MS); };
    let timer: ReturnType<typeof setInterval> | undefined;
    function startTimer() {
      clearInterval(timer);
      timer = setInterval(() => { void refreshRemoteConfig(); }, REMOTE_REFRESH_MS);
    }
    if (AppState.currentState === 'active') startTimer();
    const subscription = AppState.addEventListener('change', (state) => {
      clearInterval(timer);
      if (state === 'active') {
        startTimer();
        void refreshRemoteConfig();
      }
    });
    return () => {
      active = false;
      clearInterval(timer);
      refreshOnNetworkError.current = () => {};
      subscription.remove();
    };
  }, [readiness]);

  const api = useMemo<ApiClient>(() => {
    if (client) return client;
    if (demoMode) return new MockApiClient();
    // The constructor stores these callbacks; their refs are read only when a request runs.
    // eslint-disable-next-line react-hooks/refs
    return new LiveApiClient({
      getBaseUrl: () => baseUrls.current.custom ?? baseUrls.current.remote ?? DEFAULT_API_BASE_URL,
      getToken: tokenStore.get,
      setToken: tokenStore.set,
      onSessionExpired: () => setSessionExpired(true),
      whenReady: API_CONFIG_URL ? () => readiness.promise : undefined,
      onNetworkError: () => refreshOnNetworkError.current(),
    });
    // baseUrl stays a dependency: a new address must yield a new client so the session check and screens
    // that depend on `api` reload by themselves (e.g. a stale cached tunnel replaced by api-config.json).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, client, demoMode, readiness]);

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
        baseUrls.current.custom = normalized;
        setCustomBaseUrl(normalized);
      },
      clearBaseUrl: async () => {
        await loading.current;
        await deviceStore.delete(BASE_URL_KEY);
        baseUrls.current.custom = null;
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
