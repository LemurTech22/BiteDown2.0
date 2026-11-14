import { LiveApiClient } from '@/api/live-client';
import { MockApiClient } from '@/api/mock-client';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

test.each(['https://api.test', 'https://api.test/', 'https://api.test/v1', 'https://api.test/v1/'])('only photo fields resolve against configured base %s', async (base) => {
  const payload = { items: [{ photo_url: '/items/one/photo?sig=a', photo_preview_url: '/photos/staged/token?sig=a',
    photo_token: '/opaque-token', name: '/food', url: '/ordinary-url', nested: [{ photo_url: null },
      { photo_url: 'https://cdn.test/one.jpg?sig=keep', photo_preview_url: 'file:///picked.jpg' }] }] };
  const fetcher = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(payload) });
  const api = new LiveApiClient({ getBaseUrl: () => base, getToken: async () => 'token',
    setToken: async () => {}, onSessionExpired: jest.fn(), fetcher });
  const prefix = base.replace(/\/$/, '');
  expect(await api.getItems()).toEqual({ items: [{ ...payload.items[0],
    photo_url: `${prefix}/items/one/photo?sig=a`, photo_preview_url: `${prefix}/photos/staged/token?sig=a` }] });
  expect(fetcher.mock.calls[0][0]).toBe(`${prefix}/items`);
});

test('relative photo resolution reaches section, mutation, staged and shared response shapes', async () => {
  const payload = { sections: [{ items: [{ photo_url: '/items/a/photo?sig=new' }] }],
    item: { photo_url: '/items/b/photo?sig=new' }, candidates: [{ photo_preview_url: '/photos/staged/c?sig=new', photo_token: 'c' }],
    listings: [{ item: { photo_url: '/items/d/photo?sig=new' }, pickup: { note: '/not-a-photo' } }] };
  const fetcher = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(payload) });
  const api = new LiveApiClient({ getBaseUrl: () => 'https://api.test/base/', getToken: async () => null,
    setToken: async () => {}, onSessionExpired: jest.fn(), fetcher });
  expect(await api.getItems()).toEqual({
    sections: [{ items: [{ photo_url: 'https://api.test/base/items/a/photo?sig=new' }] }],
    item: { photo_url: 'https://api.test/base/items/b/photo?sig=new' },
    candidates: [{ photo_preview_url: 'https://api.test/base/photos/staged/c?sig=new', photo_token: 'c' }],
    listings: [{ item: { photo_url: 'https://api.test/base/items/d/photo?sig=new' }, pickup: { note: '/not-a-photo' } }],
  });
});

test('mock photo survives remove/restore, and used or foreign tokens never attach another photo', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'photo-qa@example.com', password: 'password-qa', display_name: 'QA' });
  const { candidates } = await api.fromPhoto({ uri: 'file:///apple-crop.jpg', mode: 'single' });
  const { items: [item] } = await api.createItems({ items: [candidates[0]] });
  expect(item.photo_url).toBe('file:///apple-crop.jpg');
  expect((await api.removeItem(item.id, { outcome: 'used' })).item.photo_url).toBe(item.photo_url);
  expect((await api.restoreItem(item.id)).item.photo_url).toBe(item.photo_url);
  expect((await api.createItems({ items: [candidates[0]] })).items[0].photo_url).toBeNull();
  const staged = (await api.fromPhoto({ uri: 'file:///private-crop.jpg', mode: 'single' })).candidates[0];
  await api.signup({ email: 'other-qa@example.com', password: 'password-qa', display_name: 'Other' });
  expect((await api.createItems({ items: [staged] })).items[0].photo_url).toBeNull();
  await api.login({ email: 'photo-qa@example.com', password: 'password-qa' });
  expect((await api.createItems({ items: [staged] })).items[0].photo_url).toBe('file:///private-crop.jpg');
});
