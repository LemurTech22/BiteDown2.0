const previousConfigUrl = process.env.EXPO_PUBLIC_API_CONFIG_URL;
const previousDev = __DEV__;
let config: typeof import('../config');

function loadConfig(url = 'https://config.example.com/api-config.json') {
  process.env.EXPO_PUBLIC_API_CONFIG_URL = url;
  jest.isolateModules(() => { config = jest.requireActual('../config'); });
}

beforeEach(() => loadConfig());
afterEach(() => {
  if (previousConfigUrl === undefined) delete process.env.EXPO_PUBLIC_API_CONFIG_URL;
  else process.env.EXPO_PUBLIC_API_CONFIG_URL = previousConfigUrl;
  jest.useRealTimers();
  Object.assign(globalThis, { __DEV__: previousDev });
});

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

test('missing config URL makes no request', async () => {
  loadConfig('');
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>();
  await expect(config.fetchRemoteApiBaseUrl(fetcher)).resolves.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  [' https://api.example.com/v1/// ', 'https://api.example.com/v1'],
  ['http://localhost:5055/', 'http://localhost:5055'],
  ['http://127.0.0.1:5055', 'http://127.0.0.1:5055'],
])('accepts and normalizes %s with an unbound fetch call', async (value, expected) => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>(async function () {
    return response({ api_base_url: value });
  });
  await expect(config.fetchRemoteApiBaseUrl(fetcher)).resolves.toBe(expected);
  expect(fetcher.mock.contexts).toEqual([undefined]);
  expect(fetcher).toHaveBeenCalledWith('https://config.example.com/api-config.json', {
    method: 'GET', cache: 'no-store', signal: expect.any(AbortSignal),
  });
});

test.each([
  'http://localhost:5055', 'http://127.0.0.1:5055', 'https://localhost',
  'https://127.0.0.1', 'https://127.1.2.3', 'https://[::1]',
  'https://LOCALHOST.', 'https://demo.localhost',
])('rejects loopback remote address %s in release builds', (url) => {
  Object.assign(globalThis, { __DEV__: false });
  expect(config.normalizeRemoteBaseUrl(url)).toBeNull();
});

test('release builds accept public HTTPS remote addresses', () => {
  Object.assign(globalThis, { __DEV__: false });
  expect(config.normalizeRemoteBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
});

test.each([
  null, {}, [], { api_base_url: null }, { api_base_url: 123 },
  { api_base_url: '' }, { api_base_url: 'not a URL' },
  { api_base_url: 'ftp://example.com' }, { api_base_url: 'http://api.example.com' },
  { api_base_url: 'http://localhost.example.com' }, { api_base_url: 'http://localhost@evil.example.com' },
])('ignores invalid config %j', async (body) => {
  await expect(config.fetchRemoteApiBaseUrl(jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockResolvedValue(response(body)))).resolves.toBeNull();
});

test('ignores HTTP errors, network errors, and malformed JSON', async () => {
  const json = jest.fn();
  await expect(config.fetchRemoteApiBaseUrl(jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockResolvedValue({ ok: false, json } as unknown as Response))).resolves.toBeNull();
  expect(json).not.toHaveBeenCalled();
  await expect(config.fetchRemoteApiBaseUrl(jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockRejectedValue(new Error('Offline')))).resolves.toBeNull();
  await expect(config.fetchRemoteApiBaseUrl(jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockResolvedValue({
    ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); },
  } as unknown as Response))).resolves.toBeNull();
});

test('aborts a timed out request and never throws', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>((_url, init) => new Promise((_resolve, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const result = config.fetchRemoteApiBaseUrl(fetcher, 50);
  await jest.advanceTimersByTimeAsync(50);
  await expect(result).resolves.toBeNull();
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('clears the timeout after a successful request', async () => {
  jest.useFakeTimers();
  await config.fetchRemoteApiBaseUrl(jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockResolvedValue(response({ api_base_url: 'https://api.example.com' })));
  expect(jest.getTimerCount()).toBe(0);
});
