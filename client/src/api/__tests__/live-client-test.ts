import { File } from 'expo-file-system';

import { LiveApiClient } from '@/api/live-client';
import { ApiError } from '@/api/errors';

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ bytes: async () => new Uint8Array([1, 2, 3]) })),
}));

function client() {
  return new LiveApiClient({
    getBaseUrl: () => 'http://localhost:5055/',
    getToken: async () => 'token',
    setToken: async () => {},
    onSessionExpired: jest.fn(),
  });
}

afterEach(() => jest.restoreAllMocks());

const cases: { name: string; path: string; method: string; body?: unknown; run: (api: LiveApiClient) => Promise<unknown> }[] = [
  { name: "barcode", path: "/items/barcode/a%2Fb", method: 'GET', run: (api) => api.getBarcode('a/b') },
  { name: "tips", path: "/tips", method: 'GET', run: (api) => api.getTips() },
  { name: "pantry", path: "/share", method: 'GET', run: (api) => api.getShare() },
  { name: "share create", path: "/share", method: 'POST', body: {"item_id":"food","group_id":"group","pickup":{"note":"Porch"}}, run: (api) => api.createShare({ item_id: 'food', group_id: 'group', pickup: { note: 'Porch' } }) },
  { name: "share edit", path: "/share/a%2Fb", method: 'PATCH', body: {"pickup":{"lat":29,"lng":-95,"place_name":"Kitchen"}}, run: (api) => api.updateShare('a/b', { pickup: { lat: 29, lng: -95, place_name: 'Kitchen' } }) },
  { name: "share clear", path: "/share/a%2Fb", method: 'PATCH', body: {"pickup":null}, run: (api) => api.updateShare('a/b', { pickup: null }) },
  { name: "share delete", path: "/share/a%2Fb", method: 'DELETE', run: (api) => api.deleteShare('a/b') },
  { name: "claim", path: "/share/a%2Fb/claim", method: 'POST', run: (api) => api.claimShare('a/b') },
  { name: "friends", path: "/friends", method: 'GET', run: (api) => api.getFriends() },
  { name: "friend code", path: "/friends/code", method: 'GET', run: (api) => api.getFriendCode() },
  { name: "email friend", path: "/friends", method: 'POST', body: {"email":"ana@example.com"}, run: (api) => api.addFriend({ email: 'ana@example.com' }) },
  { name: "code friend", path: "/friends", method: 'POST', body: {"code":"opaque"}, run: (api) => api.addFriend({ code: 'opaque' }) },
  { name: "accept", path: "/friends/a%2Fb/accept", method: 'POST', run: (api) => api.acceptFriend('a/b') },
  { name: "delete friend", path: "/friends/a%2Fb", method: 'DELETE', run: (api) => api.deleteFriend('a/b') },
  { name: "groups", path: "/groups", method: 'GET', run: (api) => api.getGroups() },
  { name: "create group", path: "/groups", method: 'POST', body: {"name":"Flat 4B"}, run: (api) => api.createGroup({ name: 'Flat 4B' }) },
  { name: "join group", path: "/groups/join", method: 'POST', body: {"invite_code":"F4AT8BCD"}, run: (api) => api.joinGroup({ invite_code: 'F4AT8BCD' }) },
  { name: "group detail", path: "/groups/a%2Fb", method: 'GET', run: (api) => api.getGroup('a/b') },
  { name: "group pantry", path: "/groups/a%2Fb/pantry", method: 'GET', run: (api) => api.getGroupPantry('a/b') },
  { name: "leave", path: "/groups/a%2Fb/leave", method: 'POST', run: (api) => api.leaveGroup('a/b') },
  { name: "requests", path: "/requests", method: 'GET', run: (api) => api.getRequests() },
  { name: "mine", path: "/requests?mine=1", method: 'GET', run: (api) => api.getRequests({ mine: true }) },
  { name: "mine false", path: "/requests", method: 'GET', run: (api) => api.getRequests({ mine: false }) },
  { name: "new request", path: "/requests", method: 'POST', body: {"text":"An onion?","audiences":{"friends":true,"group_ids":["group"]}}, run: (api) => api.createRequest({ text: 'An onion?', audiences: { friends: true, group_ids: ['group'] } }) },
  { name: "cancel request", path: "/requests/a%2Fb", method: 'DELETE', run: (api) => api.deleteRequest('a/b') },
  { name: "fulfil", path: "/requests/a%2Fb/fulfil", method: 'POST', run: (api) => api.fulfilRequest('a/b') },
  { name: "reachable", path: "/people/reachable", method: 'GET', run: (api) => api.getReachablePeople() },
  { name: "item recipients", path: "/people/reachable?item_id=a%2Fb", method: 'GET', run: (api) => api.getReachablePeople('a/b') },
];

test.each(cases)('$name builds the authenticated request', async ({ path, method, body, run }) => {
  const payload = { result: 'server response' };
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, text: async () => JSON.stringify(payload),
  } as Response);
  expect(await run(client())).toEqual(payload);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(`http://localhost:5055${path}`);
  expect(options?.method).toBe(method);
  expect(options?.body === undefined ? undefined : JSON.parse(options.body as string)).toEqual(body);
  const headers = options?.headers as Headers;
  expect(headers.get('Authorization')).toBe('Bearer token');
  expect(headers.get('Content-Type')).toBe(body === undefined ? null : 'application/json');
});

test('deleteFriend handles the empty 204 response', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204, text: async () => '' } as Response);
  await expect(client().deleteFriend('friend')).resolves.toBeUndefined();
});

test.each(['receipt', 'single'] as const)('%s upload sends bytes in multipart without a JSON content type', async (kind) => {
  const append = jest.spyOn(FormData.prototype, 'append');
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true, status: 200, text: async () => JSON.stringify({ candidates: [] }),
  } as Response);
  const api = client();
  const input = { uri: 'file:///food.png', fileName: 'food.png', mimeType: 'image/png' };
  if (kind === 'receipt') await api.fromReceipt(input);
  else await api.fromPhoto({ ...input, mode: 'single', enrich: ['expiry', 'nutrition'] });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(`http://localhost:5055/items/from-${kind === 'receipt' ? 'receipt' : 'photo'}`);
  expect(options?.method).toBe('POST');
  expect((options?.headers as Headers).get('Content-Type')).toBeNull();
  expect(options?.body).toBeInstanceOf(FormData);
  // Node's FormData coerces native byte parts; inspect them before that coercion.
  const image = append.mock.calls.find(([name]) => name === 'image')![1] as unknown as { name: string; type: string; bytes: () => Promise<Uint8Array> };
  expect(image).toMatchObject({ name: 'food.png', type: 'image/png', bytes: expect.any(Function) });
  expect(await image.bytes()).toEqual(new Uint8Array([1, 2, 3]));
  expect(File).toHaveBeenCalledWith(input.uri);
  if (kind === 'single') {
    expect(append).toHaveBeenCalledWith('mode', 'single');
    expect(append).toHaveBeenCalledWith('enrich', 'expiry,nutrition');
  } else expect(append).toHaveBeenCalledTimes(1);
});

test('social failures retain the server error code', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false, status: 409, text: async () => JSON.stringify({ error: { code: 'already_claimed', message: 'Already claimed.' } }),
  } as Response);
  await expect(client().claimShare('id')).rejects.toMatchObject({ status: 409, code: 'already_claimed' });
});

test('waits for readiness before reading the URL, without delaying later requests', async () => {
  let baseUrl = 'https://old.example.com';
  let ready!: () => void;
  const readiness = new Promise<void>((resolve) => { ready = resolve; });
  const getBaseUrl = jest.fn(() => baseUrl);
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>()
    .mockResolvedValue({ ok: true, status: 200, text: async () => '{"status":"ok"}' } as Response);
  const api = new LiveApiClient({
    getBaseUrl, getToken: async () => null, setToken: async () => {},
    onSessionExpired: jest.fn(), whenReady: () => readiness, fetcher,
  });
  const first = api.health();
  const concurrent = api.health();
  expect(getBaseUrl).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  baseUrl = 'https://new.example.com';
  ready();
  await Promise.all([first, concurrent]);
  await api.health();
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const [url] of fetcher.mock.calls) expect(url).toBe('https://new.example.com/health');
});

test.each([
  new TypeError('Network request failed'),
  new ApiError(0, 'upstream_unavailable', 'Offline'),
])('notifies network failures without retrying the request (%s)', async (error) => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>().mockRejectedValue(error);
  const onNetworkError = jest.fn();
  const api = new LiveApiClient({
    getBaseUrl: () => 'https://api.example.com', getToken: async () => null,
    setToken: async () => {}, onSessionExpired: jest.fn(), onNetworkError, fetcher,
  });
  await expect(api.health()).rejects.toMatchObject({ status: 0 });
  expect(onNetworkError).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('HTTP failures do not trigger a network refresh', async () => {
  const fetcher = jest.fn<ReturnType<typeof fetch>, [input: RequestInfo | URL, init?: RequestInit]>()
    .mockResolvedValue({ ok: false, status: 503, text: async () => '' } as Response);
  const onNetworkError = jest.fn();
  const api = new LiveApiClient({
    getBaseUrl: () => 'https://api.example.com', getToken: async () => null,
    setToken: async () => {}, onSessionExpired: jest.fn(), onNetworkError, fetcher,
  });
  await expect(api.health()).rejects.toMatchObject({ status: 503 });
  expect(onNetworkError).not.toHaveBeenCalled();
});
