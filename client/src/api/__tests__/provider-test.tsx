import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiProvider, DEFAULT_API_BASE_URL, useApi } from '@/api';
import { deviceStore } from '@/storage/key-value-store';

jest.mock('@/api/config', () => {
  const previous = process.env.EXPO_PUBLIC_API_CONFIG_URL;
  process.env.EXPO_PUBLIC_API_CONFIG_URL = 'https://config.example.com/api-config.json';
  const config = jest.requireActual<typeof import('../config')>('@/api/config');
  if (previous === undefined) delete process.env.EXPO_PUBLIC_API_CONFIG_URL;
  else process.env.EXPO_PUBLIC_API_CONFIG_URL = previous;
  return { ...config, DEFAULT_DEMO_MODE: false };
});
jest.mock('@/storage/key-value-store', () => ({ deviceStore: { get: jest.fn(), set: jest.fn(), delete: jest.fn() } }));
jest.mock('@/auth/token-store', () => ({ tokenStore: { get: jest.fn(), set: jest.fn() } }));

const store = jest.mocked(deviceStore);
let current: ReturnType<typeof useApi>;
let onAppState: (state: AppStateStatus) => void;
let fetcher: jest.SpiedFunction<typeof fetch>;
let remove: jest.Mock;
function Probe() {
  const value = useApi();
  useEffect(() => { current = value; }, [value]);
  return null;
}
function response(value: unknown): Response {
  return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) } as Response;
}

beforeEach(() => {
  AppState.currentState = 'active';
  store.get.mockReset().mockResolvedValue(null);
  store.set.mockReset().mockResolvedValue(undefined);
  store.delete.mockReset().mockResolvedValue(undefined);
  fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}));
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onAppState = listener;
    return { remove };
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([
  ['https://custom.example.com', 'https://remote.example.com', 'https://custom.example.com', 'custom'],
  [null, 'https://remote.example.com', 'https://remote.example.com', 'remote'],
  [null, null, DEFAULT_API_BASE_URL, 'default'],
])('resolves custom %s and remote %s to %s (%s)', async (custom, remote, expected, source) => {
  store.get.mockImplementation(async (key) => key === 'settings.apiBaseUrl' ? custom : null);
  fetcher.mockResolvedValue(response({ api_base_url: remote }));
  await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => {
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(current.baseUrl).toBe(expected);
    expect(current.baseUrlSource).toBe(source);
  });
  if (remote) expect(store.set).toHaveBeenCalledWith('settings.remoteApiBaseUrl', remote);
});

test('uses the cached remote before the startup request returns, then caches the new address', async () => {
  store.get.mockImplementation(async (key) => key === 'settings.remoteApiBaseUrl' ? 'https://cached.example.com/' : null);
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => expect(current.baseUrl).toBe('https://cached.example.com'));
  expect(current.baseUrlSource).toBe('remote');
  await expect(current.api.health()).resolves.toEqual({});
  expect(fetcher).toHaveBeenLastCalledWith('https://cached.example.com/health', expect.any(Object));
  const cachedClient = current.api;
  await act(async () => finish(response({ api_base_url: 'https://new.example.com/' })));
  expect(current.baseUrl).toBe('https://new.example.com');
  expect(current.api).not.toBe(cachedClient);
  expect(store.set).toHaveBeenCalledWith('settings.remoteApiBaseUrl', 'https://new.example.com');
});

test('a request from a child mount waits for storage and the first config fetch, then uses its URL', async () => {
  let loadStored!: (value: string | null) => void;
  store.get.mockImplementationOnce(() => new Promise((resolve) => { loadStored = resolve; }));
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const requests: Promise<unknown>[] = [];
  function RequestOnMount() {
    const { api } = useApi();
    const started = useRef(false);
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      requests.push(api.health());
    }, [api]);
    return null;
  }
  await render(<ApiProvider><Probe /><RequestOnMount /></ApiProvider>);
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => loadStored(null));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish(response({ api_base_url: 'https://ready.example.com' })));
  await expect(requests[0]).resolves.toEqual({});
  expect(fetcher).toHaveBeenLastCalledWith('https://ready.example.com/health', expect.any(Object));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a timed out initial config fetch releases requests to the default URL', async () => {
  jest.useFakeTimers();
  fetcher.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  await render(<ApiProvider><Probe /></ApiProvider>);
  const request = current.api.health();
  await act(async () => { await jest.advanceTimersByTimeAsync(4999); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  await expect(request).resolves.toEqual({});
  expect(fetcher).toHaveBeenLastCalledWith(`${DEFAULT_API_BASE_URL}/health`, expect.any(Object));
  await expect(current.api.health()).resolves.toEqual({});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('an unsuccessful initial config fetch also releases waiting requests', async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await render(<ApiProvider><Probe /></ApiProvider>);
  const request = current.api.health();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish(response({ api_base_url: 'invalid' })));
  await expect(request).resolves.toEqual({});
  expect(fetcher).toHaveBeenLastCalledWith(`${DEFAULT_API_BASE_URL}/health`, expect.any(Object));
});

test.each([{}, { api_base_url: 'http://insecure.example.com' }, null])('invalid or missing remote config %j preserves the cache', async (body) => {
  store.get.mockImplementation(async (key) => key === 'settings.remoteApiBaseUrl' ? 'https://cached.example.com' : null);
  fetcher.mockResolvedValue(response(body));
  await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(current.baseUrl).toBe('https://cached.example.com');
  expect(current.baseUrlSource).toBe('remote');
  expect(store.set).not.toHaveBeenCalled();
});

test('ignores invalid saved remote addresses and tolerates storage read failures', async () => {
  store.get.mockImplementation(async (key) => {
    if (key === 'settings.remoteApiBaseUrl') return 'http://insecure.example.com';
    throw new Error('Storage unavailable');
  });
  await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(current.baseUrl).toBe(DEFAULT_API_BASE_URL);
  expect(current.baseUrlSource).toBe('default');
});

test.each([null, 'https://remote.example.com'])('clearBaseUrl deletes the custom override and falls back to %s', async (remote) => {
  fetcher.mockResolvedValue(response({ api_base_url: remote }));
  await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  await act(async () => current.setBaseUrl(' https://custom.example.com/ '));
  expect(current.baseUrlSource).toBe('custom');
  expect(store.set).toHaveBeenCalledWith('settings.apiBaseUrl', 'https://custom.example.com');
  await act(async () => current.clearBaseUrl());
  expect(store.delete).toHaveBeenCalledWith('settings.apiBaseUrl');
  expect(current.baseUrl).toBe(remote ?? DEFAULT_API_BASE_URL);
  expect(current.baseUrlSource).toBe(remote ? 'remote' : 'default');
});

test('a failed override deletion leaves the custom address applied', async () => {
  await render(<ApiProvider><Probe /></ApiProvider>);
  await act(async () => current.setBaseUrl('https://custom.example.com'));
  store.delete.mockRejectedValueOnce(new Error('Cannot delete'));
  await act(async () => { await expect(current.clearBaseUrl()).rejects.toThrow('Cannot delete'); });
  expect(current.baseUrlSource).toBe('custom');
  expect(current.baseUrl).toBe('https://custom.example.com');
});

test('refreshes on active at most once per minute and preserves the live client for unchanged URLs', async () => {
  let now = 100_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  fetcher.mockResolvedValue(response({ api_base_url: 'https://remote.example.com' }));
  const screen = await render(<ApiProvider><Probe /></ApiProvider>);
  await waitFor(() => expect(current.baseUrlSource).toBe('remote'));
  const liveClient = current.api;
  await act(async () => { onAppState('active'); });
  now += 59_999;
  await act(async () => { onAppState('active'); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  now += 1;
  await act(async () => { onAppState('background'); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { onAppState('active'); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(current.api).toBe(liveClient);
  await act(async () => current.setBaseUrl('https://remote.example.com/'));
  expect(current.baseUrlSource).toBe('custom');
  expect(current.api).toBe(liveClient);
  now += 60_000;
  fetcher.mockResolvedValue(response({ api_base_url: 'https://updated.example.com' }));
  await act(async () => { onAppState('active'); });
  expect(current.baseUrl).toBe('https://remote.example.com');
  expect(current.api).toBe(liveClient);
  await act(async () => current.clearBaseUrl());
  expect(current.baseUrl).toBe('https://updated.example.com');
  expect(current.api).not.toBe(liveClient);
  await screen.unmount();
  expect(remove).toHaveBeenCalled();
});

test('polls every minute while active and clears polling on background and unmount', async () => {
  jest.useFakeTimers();
  const intervals = jest.spyOn(globalThis, 'setInterval');
  const clearIntervals = jest.spyOn(globalThis, 'clearInterval');
  fetcher.mockResolvedValue(response({ api_base_url: 'https://remote.example.com' }));
  const screen = await render(<ApiProvider><Probe /></ApiProvider>);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { await jest.advanceTimersByTimeAsync(59_999); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(response({ api_base_url: 'https://updated.example.com' }));
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(current.baseUrl).toBe('https://updated.example.com');
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => onAppState('background'));
  expect(clearIntervals).toHaveBeenCalledWith(intervals.mock.results[0].value);
  await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => onAppState('active'));
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(4);
  await screen.unmount();
  expect(clearIntervals).toHaveBeenLastCalledWith(intervals.mock.results[intervals.mock.results.length - 1].value);
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test('does not start a polling timer until an initially backgrounded app becomes active', async () => {
  jest.useFakeTimers();
  const intervals = jest.spyOn(globalThis, 'setInterval');
  AppState.currentState = 'background';
  await render(<ApiProvider><Probe /></ApiProvider>);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(intervals).not.toHaveBeenCalled();
  await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => onAppState('active'));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(intervals).toHaveBeenCalledTimes(1);
});

test('network failures refresh config at most every ten seconds without retrying requests', async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  fetcher.mockImplementation(async (url) => {
    if (url === 'https://config.example.com/api-config.json') return response({ api_base_url: 'https://remote.example.com' });
    throw new TypeError('Network request failed');
  });
  const screen = await render(<ApiProvider><Probe /></ApiProvider>);
  await act(async () => { await jest.advanceTimersByTimeAsync(9999); });
  await expect(current.api.health()).rejects.toMatchObject({ status: 0 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(async () => { throw new TypeError('Offline'); })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await expect(current.api.health()).rejects.toMatchObject({ status: 0 });
  expect(fetcher).toHaveBeenCalledTimes(4);
  await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
  await expect(current.api.health()).rejects.toMatchObject({ status: 0 });
  expect(fetcher).toHaveBeenCalledTimes(5); // The config fetch is still in flight.
  await act(async () => finish(response({ api_base_url: 'https://updated.example.com' })));
  expect(current.baseUrl).toBe('https://updated.example.com');
  await act(async () => { await expect(current.api.health()).rejects.toMatchObject({ status: 0 }); });
  expect(fetcher).toHaveBeenCalledTimes(7);
  const apiUrls = fetcher.mock.calls.map(([url]) => url).filter((url) => url !== 'https://config.example.com/api-config.json');
  expect(apiUrls).toEqual([
    'https://remote.example.com/health', 'https://remote.example.com/health',
    'https://remote.example.com/health', 'https://updated.example.com/health',
  ]);
  await screen.unmount();
});
