import { ApiError, LiveApiClient, MockApiClient } from '@/api';

test('updateItem sends an authenticated JSON PATCH to the encoded item URL', async () => {
  const response = { item: { id: 'item/id', storage: 'pantry' } };
  const fetcher = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(response) });
  const api = new LiveApiClient({
    getBaseUrl: () => 'http://localhost:5001',
    getToken: async () => 'test-token',
    setToken: async () => {},
    onSessionExpired: jest.fn(),
    fetcher,
  });
  expect(await api.updateItem('item/id', { storage: 'pantry', reestimate_expiry: true })).toEqual(response);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('http://localhost:5001/items/item%2Fid');
  expect(options.method).toBe('PATCH');
  expect(JSON.parse(options.body)).toEqual({ storage: 'pantry', reestimate_expiry: true });
  expect(options.headers.get('Authorization')).toBe('Bearer test-token');
  expect(options.headers.get('Content-Type')).toBe('application/json');
});

test('mock updates persist, retain unrelated fields and leave Impact unchanged', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'move@example.com', password: 'test-password', display_name: 'Contributor' });
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apple', storage: 'fridge' }] });
  const before = await api.getImpact();
  const { item: moved } = await api.updateItem(item.id, { storage: 'pantry' });
  expect(moved).toEqual({ ...item, storage: 'pantry', predicted_expiry: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) });
  expect(await api.getItems({ storage: 'fridge' })).toEqual({ items: [] });
  expect(await api.getItems({ storage: 'pantry' })).toEqual({ items: [moved] });
  expect(await api.getImpact()).toEqual(before);
  moved.name = 'Changed copy';
  expect((await api.updateItem(item.id, { predicted_expiry: '2027-01-01' })).item)
    .toEqual({ ...item, storage: 'pantry', predicted_expiry: '2027-01-01', expiry_source: 'user' });
});

test('mock rejects unknown, removed and other contributors’ items', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'owner@example.com', password: 'test-password', display_name: 'Owner' });
  const { items: [active, removed] } = await api.createItems({ items: [{ name: 'Apple' }, { name: 'Banana' }] });
  await api.removeItem(removed.id, { outcome: 'used' });
  await expect(api.updateItem('missing', { storage: 'pantry' })).rejects.toEqual(expect.objectContaining<ApiError>({
    status: 404, code: 'not_found', name: 'ApiError', message: 'Item not found.',
  }));
  await expect(api.updateItem(removed.id, { storage: 'pantry' })).rejects.toMatchObject({ status: 404 });
  await api.signup({ email: 'other@example.com', password: 'test-password', display_name: 'Other' });
  await expect(api.updateItem(active.id, { storage: 'pantry' })).rejects.toMatchObject({ status: 403 });
});
