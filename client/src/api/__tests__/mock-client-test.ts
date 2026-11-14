import { MockApiClient } from '@/api/mock-client';
import { RESTORE_WINDOW_MS } from '@/api/removal-window';
import type { ExpirySource, ItemCategory, Storage, UpdateItemInput } from '@/api/types';

test('photo candidates preview the picked image and their tokens attach it only once', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'photo@example.com', password: 'password123', display_name: 'Demo' });
  const uri = 'file:///my-real-food.jpg';
  const { candidates: [candidate] } = await api.fromPhoto({ uri, mode: 'single' });
  expect(candidate.photo_token).toEqual(expect.any(String));
  expect(candidate.photo_preview_url).toBe(uri);
  const { items: [photo, reused, plain] } = await api.createItems({ items: [candidate, candidate, { name: 'Rice' }] });
  expect(photo.photo_url).toBe(uri);
  expect(reused.photo_url).toBeNull();
  expect(plain.photo_url).toBeNull();
  expect((await api.removeItem(photo.id, { outcome: 'used' })).item.photo_url).toBe(uri);
  expect((await api.restoreItem(photo.id)).item.photo_url).toBe(uri);
});

test('demo photo tokens belong to the user who picked the photo', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'owner@example.com', password: 'password123', display_name: 'Owner' });
  const { candidates: [candidate] } = await api.fromPhoto({ uri: 'file:///private.jpg', mode: 'fridge' });
  await api.signup({ email: 'other@example.com', password: 'password123', display_name: 'Other' });
  expect((await api.createItems({ items: [candidate] })).items[0].photo_url).toBeNull();
  await api.login({ email: 'owner@example.com', password: 'password123' });
  expect((await api.createItems({ items: [candidate] })).items[0].photo_url).toBe('file:///private.jpg');
});

describe.each(['single', 'batch'] as const)('%s seven-day restore window', (kind) => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00Z')));
  afterEach(() => jest.useRealTimers());

  test.each([RESTORE_WINDOW_MS - 1, RESTORE_WINDOW_MS])('restore at age %s ms', async (age) => {
    const api = new MockApiClient();
    await api.signup({ email: 'restore@example.com', password: 'password123', display_name: 'Demo' });
    const { items } = await api.createItems({ items: [{ name: 'Apples', est_price: 4, est_weight_kg: 1 }, { name: 'Rice' }] });
    const before = await api.getImpact('all');
    const now = Date.now();
    await api.removeBatch({ item_ids: items.map((item) => item.id), outcome: 'used' });
    jest.setSystemTime(now + age);
    const restore = () => kind === 'single' ? api.restoreItem(items[0].id) : api.restoreBatch(items.map((item) => item.id));
    if (age === RESTORE_WINDOW_MS) {
      await expect(restore()).rejects.toMatchObject({ code: 'restore_window_expired', message: 'Items can only be restored within 7 days of removal.' });
      expect((await api.getItems({ include_removed: true }) as { items: { removed_at: string }[] }).items.every((item) => item.removed_at)).toBe(true);
    } else {
      await restore();
      if (kind === 'single') await api.restoreItem(items[1].id);
      jest.setSystemTime(now);
      expect(await api.getImpact('all')).toEqual(before);
      expect(await api.getItems()).toEqual({ items });
    }
  });
});

describe('storage expiry re-estimation', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00Z')));
  afterEach(() => jest.useRealTimers());

  const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const cases: [string, ItemCategory, Storage, number, ExpirySource, UpdateItemInput, number, ExpirySource][] = [
    ['freezing extends', 'meat', 'fridge', 2, 'default', { storage: 'freezer' }, 180, 'default'],
    ['thawing meat is capped', 'meat', 'freezer', 100, 'default', { storage: 'fridge' }, 2, 'default'],
    ['thawing seafood is capped', 'seafood', 'freezer', 100, 'ml', { storage: 'fridge' }, 2, 'default'],
    ['thawing leftovers is capped', 'leftovers', 'freezer', 60, 'gemini', { storage: 'fridge' }, 3, 'default'],
    ['thawing to pantry uses the shorter default', 'meat', 'freezer', 100, 'default', { storage: 'pantry' }, 1, 'default'],
    ['other categories have no thaw cap', 'dairy', 'freezer', 60, 'default', { storage: 'fridge' }, 10, 'default'],
    ['fridge to pantry is proportional', 'produce_hardy', 'fridge', 9, 'default', { storage: 'pantry' }, 3, 'default'],
    ['pantry to fridge rounds halves to even', 'bakery', 'pantry', 1, 'default', { storage: 'fridge' }, 2, 'default'],
    ['remaining fraction is capped at one', 'produce_hardy', 'fridge', 30, 'default', { storage: 'pantry' }, 7, 'default'],
    ['at least one day remains', 'dairy', 'fridge', 1, 'default', { storage: 'pantry' }, 1, 'default'],
    ['user date stays', 'meat', 'fridge', 8, 'user', { storage: 'freezer' }, 8, 'user'],
    ['false flag preserves user date', 'meat', 'fridge', 8, 'user', { storage: 'freezer', reestimate_expiry: false }, 8, 'user'],
    ['true flag re-estimates user date', 'meat', 'fridge', 8, 'user', { storage: 'freezer', reestimate_expiry: true }, 180, 'default'],
    ['expired freezing date stays', 'meat', 'fridge', -1, 'default', { storage: 'freezer' }, -1, 'default'],
    ['freezing on expiry day extends', 'meat', 'fridge', 0, 'default', { storage: 'freezer' }, 180, 'default'],
    ['expired fridge to pantry date stays', 'dairy', 'fridge', -1, 'default', { storage: 'pantry' }, -1, 'default'],
    ['fridge to pantry date due today stays', 'dairy', 'fridge', 0, 'default', { storage: 'pantry' }, 0, 'default'],
    ['expired thawing still uses cap', 'meat', 'freezer', -1, 'default', { storage: 'fridge' }, 2, 'default'],
    ['final category is used', 'dairy', 'fridge', 8, 'default', { storage: 'freezer', category: 'meat' }, 180, 'default'],
    ['flag alone is a no-op', 'meat', 'fridge', 8, 'user', { reestimate_expiry: true }, 8, 'user'],
    ['same storage preserves user date', 'meat', 'fridge', 8, 'user', { storage: 'fridge', reestimate_expiry: true }, 8, 'user'],
    ['same storage preserves default date', 'meat', 'freezer', 8, 'default', { storage: 'freezer', reestimate_expiry: true }, 8, 'default'],
  ];

  test.each(cases)('%s', async (_, category, storage, left, expiry_source, patch, expected, source) => {
    const { api } = await setup();
    const { items: [item] } = await api.createItems({ items: [{ name: 'Food', category, storage, predicted_expiry: isoIn(left), expiry_source }] });
    const { item: moved } = await api.updateItem(item.id, patch);
    expect(moved).toMatchObject({ storage: patch.storage ?? storage, predicted_expiry: isoIn(expected), expiry_source: source });
    expect(moved).not.toHaveProperty('reestimate_expiry');
  });

  test.each(['default', 'user'] as const)('explicit date wins over re-estimation for %s expiry', async (expiry_source) => {
    const { api } = await setup();
    const { items: [item] } = await api.createItems({ items: [{ name: 'Meat', category: 'meat', predicted_expiry: isoIn(2), expiry_source }] });
    expect((await api.updateItem(item.id, { storage: 'freezer', reestimate_expiry: true, predicted_expiry: isoIn(20) })).item)
      .toMatchObject({ predicted_expiry: isoIn(20), expiry_source: 'user' });
  });

  test.each([null, 0, 1, 'true', [], {}])('rejects a non-boolean flag: %p', async (flag) => {
    const { api } = await setup();
    const { items: [item] } = await api.createItems({ items: [{ name: 'Food' }] });
    await expect(api.updateItem(item.id, { storage: 'freezer', reestimate_expiry: flag } as UpdateItemInput))
      .rejects.toMatchObject({ status: 400, code: 'validation_error' });
    expect((await api.updateItem(item.id, {})).item).toEqual(item);
  });
});

async function setup() {
  const api = new MockApiClient();
  const { user } = await api.signup({ email: 'test@example.com', password: 'password123', display_name: 'Contributor' });
  return { api, user };
}

test('new methods require a signed-in user', async () => {
  const api = new MockApiClient();
  const calls = [
    () => api.getBarcode('012345678905'), () => api.getTips(), () => api.getShare(),
    () => api.createShare({ item_id: 'x' }), () => api.updateShare('x', { pickup: null }),
    () => api.deleteShare('x'), () => api.claimShare('x'), () => api.getFriends(), () => api.getFriendCode(),
    () => api.addFriend({ email: 'ana@example.com' }), () => api.acceptFriend('x'), () => api.deleteFriend('x'),
    () => api.getGroups(), () => api.createGroup({ name: 'Group' }), () => api.joinGroup({ invite_code: 'x' }),
    () => api.getGroup('x'), () => api.getGroupPantry('x'), () => api.leaveGroup('x'), () => api.getRequests(),
    () => api.createRequest({ text: 'Food?', audiences: { friends: true } }),
    () => api.deleteRequest('x'), () => api.fulfilRequest('x'), () => api.getReachablePeople(),
  ];
  for (const call of calls) await expect(call()).rejects.toMatchObject({ status: 401 });
});

test('social seeds leave the personal pantry and impact empty', async () => {
  const { api } = await setup();
  expect((await api.getFriends()).friends).toHaveLength(2);
  expect((await api.getGroups()).groups).toHaveLength(1);
  expect((await api.getRequests()).requests).toHaveLength(2);
  expect(await api.getItems()).toEqual({ items: [] });
  expect((await api.getImpact()).saved.count).toBe(0);
  expect((await api.getTips()).tips[0].code).toBe('getting_started');
});

test('barcode lookup distinguishes hits, misses and invalid codes without saving candidates', async () => {
  const { api } = await setup();
  const hit = await api.getBarcode('012345678905');
  expect(hit.candidate).toMatchObject({ barcode: '012345678905', brand: 'BiteDown Market', source: 'barcode' });
  hit.candidate.name = 'Changed copy';
  expect((await api.getBarcode('012345678905')).candidate.name).toBe('Whole grain cereal');
  await expect(api.getBarcode('000000000000')).rejects.toMatchObject({ status: 404 });
  await expect(api.getBarcode('invalid')).rejects.toMatchObject({ status: 400 });
  expect(await api.getItems()).toEqual({ items: [] });
});

test('receipt includes a raw non-food line and single-photo mode stays supported', async () => {
  const { api } = await setup();
  const receipt = await api.fromReceipt({ uri: 'file:///receipt.jpg' });
  expect(receipt).toMatchObject({ total: 5.5, source: 'ocr', categorized_by: 'heuristic' });
  expect(receipt.candidates).toHaveLength(2);
  expect(receipt.candidates[1]).toMatchObject({ name: 'Paper towels', category: 'other', food_group: 'other', receipt_text: 'PAPER TOWELS 3.00' });
  expect((await api.fromPhoto({ uri: 'file:///food.jpg', mode: 'single' })).candidates[0].source).toBe('single_photo');
});

test('pantry hides pickup details until claim and rejects a second claim', async () => {
  const { api, user } = await setup();
  const { listings } = await api.getShare();
  const available = listings.find((listing) => !listing.claimed_by_me)!;
  const claimed = listings.find((listing) => listing.claimed_by_me)!;
  expect(available).toMatchObject({ pickup: null, pickup_set: true });
  expect(claimed.pickup?.note).toBe('On the porch shelf');
  expect((await api.claimShare(available.id)).listing).toMatchObject({ claimed_by: user.id, pickup_set: true });
  expect((await api.getShare()).listings.find((listing) => listing.id === available.id)).toMatchObject({ claimed_by_me: true, pickup: { note: 'On the porch shelf' } });
  await expect(api.claimShare(available.id)).rejects.toMatchObject({ code: 'already_claimed' });
  await expect(api.deleteShare(available.id)).rejects.toMatchObject({ status: 403 });
  await expect(api.updateShare(available.id, { pickup: null })).rejects.toMatchObject({ status: 403 });
  await expect(api.claimShare('missing')).rejects.toMatchObject({ status: 404 });
});

test('owned listings persist edits, reject invalid spots, cancel and allow sharing again', async () => {
  const { api } = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples' }] });
  const before = await api.getImpact();
  const { listing } = await api.createShare({ item_id: item.id, pickup: { note: '  Porch  ' } });
  expect(listing.pickup).toEqual({ note: 'Porch', lat: null, lng: null, place_name: null });
  expect((await api.getShare()).listings.some((entry) => entry.id === listing.id)).toBe(false);
  await expect(api.createShare({ item_id: item.id })).rejects.toMatchObject({ code: 'already_shared' });
  await expect(api.claimShare(listing.id)).rejects.toMatchObject({ status: 400 });
  for (const pickup of [{}, { lat: 1 }, { lat: 91, lng: 0 }, { note: 'x'.repeat(121) }]) {
    await expect(api.updateShare(listing.id, { pickup })).rejects.toMatchObject({ status: 400 });
  }
  const updated = await api.updateShare(listing.id, { pickup: { lat: 29, lng: -95, place_name: 'Kitchen' } });
  expect(updated.listing.pickup).toMatchObject({ lat: 29, lng: -95, place_name: 'Kitchen' });
  expect((await api.getItems() as { items: { share: unknown }[] }).items[0].share).toMatchObject({ id: listing.id, pickup_set: true });
  expect((await api.updateShare(listing.id, { pickup: null })).listing).toMatchObject({ pickup: null, pickup_set: false });
  expect((await api.deleteShare(listing.id)).listing.status).toBe('cancelled');
  await expect(api.updateShare(listing.id, { pickup: null })).rejects.toMatchObject({ code: 'listing_closed' });
  await expect(api.deleteShare(listing.id)).rejects.toMatchObject({ code: 'listing_closed' });
  expect((await api.createShare({ item_id: item.id })).listing.id).not.toBe(listing.id);
  expect(await api.getImpact()).toEqual(before);
});

test('donating a new listing fulfils it and undo restores the share and impact', async () => {
  const { api } = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Milk' }] });
  await api.createShare({ item_id: item.id, pickup: { note: 'Porch' } });
  const before = await api.getImpact();
  expect((await api.removeItem(item.id, { outcome: 'donated' })).item.share?.status).toBe('fulfilled');
  expect((await api.restoreItem(item.id)).item.share).toMatchObject({ status: 'open', pickup: { note: 'Porch' } });
  expect(await api.getImpact()).toEqual(before);
});

test('friend email, accept, withdraw and code flows change the in-memory lists', async () => {
  const { api } = await setup();
  const incoming = (await api.getFriends()).incoming[0];
  expect((await api.acceptFriend(incoming.user_id)).friend.status).toBe('accepted');
  await expect(api.acceptFriend(incoming.user_id)).rejects.toMatchObject({ status: 404 });
  await api.deleteFriend(incoming.user_id);
  expect((await api.addFriend({ email: ' DANA@example.com ' })).friend.status).toBe('pending');
  expect((await api.getFriends()).outgoing).toHaveLength(1);
  expect((await api.addFriend({ code: 'DanaDemoCode12345' })).friend.status).toBe('accepted');
  expect((await api.getFriends()).outgoing).toHaveLength(0);
  expect((await api.addFriend({ code: 'DanaDemoCode12345' })).friend.status).toBe('accepted');
  await expect(api.addFriend({ email: 'dana@example.com' })).rejects.toMatchObject({ code: 'already_friends' });
  await expect(api.addFriend({ code: 'expired' })).rejects.toMatchObject({ code: 'invalid_code' });
  await expect(api.addFriend({ email: 'unknown@example.com' })).rejects.toMatchObject({ status: 404 });
  await api.addFriend({ email: 'eli@example.com' });
  await expect(api.addFriend({ email: 'eli@example.com' })).rejects.toMatchObject({ code: 'request_pending' });
  const sent = (await api.getFriends()).outgoing[0];
  await api.deleteFriend(sent.user_id);
  expect((await api.getFriends()).outgoing).toEqual([]);
  await expect(api.deleteFriend('missing')).rejects.toMatchObject({ status: 404 });
});

test('own friend code is reused, expires after ten minutes and rotates with less than two minutes left', async () => {
  const { api } = await setup();
  const first = await api.getFriendCode();
  expect(first.code).toHaveLength(16);
  expect(first.url).toBe(`bitedown://friend/${first.code}`);
  expect(Date.parse(first.expires_at) - Date.now()).toBeGreaterThan(599_000);
  expect(await api.getFriendCode()).toEqual(first);
  await expect(api.addFriend({ code: first.code })).rejects.toMatchObject({ status: 400, code: 'validation_error' });
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(first.expires_at) - 60_000);
  try { expect((await api.getFriendCode()).code).not.toBe(first.code); } finally { clock.mockRestore(); }
});

test('groups expose members and pantry, allow normalized rejoin and enforce membership', async () => {
  const { api } = await setup();
  const group = (await api.getGroups()).groups[0];
  expect((await api.getGroup(group.id)).group.members).toHaveLength(group.member_count);
  const pantry = (await api.getGroupPantry(group.id)).items;
  expect(pantry[0]).toMatchObject({ name: 'Carrots', added_by: 'Ana Rivera' });
  await expect(api.createShare({ item_id: (await api.createItems({ items: [{ name: 'Rice' }], group_id: group.id })).items[0].id })).rejects.toMatchObject({ status: 400 });
  await expect(api.joinGroup({ invite_code: group.invite_code })).rejects.toMatchObject({ code: 'already_member' });
  await api.leaveGroup(group.id);
  expect((await api.getGroups()).groups).toEqual([]);
  await expect(api.getGroup(group.id)).rejects.toMatchObject({ status: 403 });
  await expect(api.getGroupPantry(group.id)).rejects.toMatchObject({ status: 403 });
  await expect(api.leaveGroup(group.id)).rejects.toMatchObject({ status: 403 });
  const normalized = group.invite_code.toLowerCase().split('').join('- ');
  expect((await api.joinGroup({ invite_code: normalized })).group.role).toBe('member');
  await expect(api.getGroup('unknown')).rejects.toMatchObject({ status: 404 });
  await expect(api.joinGroup({ invite_code: 'wrong' })).rejects.toMatchObject({ status: 404 });
});

test('createGroup returns an owner membership, and leaving transfers ownership', async () => {
  const { api } = await setup();
  const { group } = await api.createGroup({ name: '  Community kitchen  ' });
  expect(group).toMatchObject({ name: 'Community kitchen', role: 'owner', member_count: 1 });
  expect((await api.getGroupPantry(group.id)).items).toEqual([]);
  await api.leaveGroup(group.id);
  expect((await api.joinGroup({ invite_code: group.invite_code })).group.role).toBe('owner');
  await expect(api.createGroup({ name: ' ' })).rejects.toMatchObject({ status: 400 });
});

test('requests create once for multiple audiences, cancel into mine history, and filter left groups', async () => {
  const { api } = await setup();
  const group = (await api.getGroups()).groups[0];
  const { request } = await api.createRequest({ text: '  Flour?  ', audiences: { friends: true, group_ids: [group.id, group.id] } });
  expect(request.text).toBe('Flour?');
  expect(request.audiences.groups).toHaveLength(1);
  expect((await api.getRequests()).requests.filter((entry) => entry.id === request.id)).toHaveLength(1);
  await expect(api.fulfilRequest(request.id)).rejects.toMatchObject({ status: 403 });
  await api.deleteRequest(request.id);
  expect((await api.getRequests()).requests.some((entry) => entry.id === request.id)).toBe(false);
  await api.leaveGroup(group.id);
  const history = (await api.getRequests({ mine: true })).requests.find((entry) => entry.id === request.id)!;
  expect(history).toMatchObject({ status: 'cancelled', audiences: { friends: true, groups: [], hidden_count: 1 } });
  await expect(api.deleteRequest(request.id)).rejects.toMatchObject({ code: 'request_closed' });
  await expect(api.createRequest({ text: 'Rice?', audiences: { group_ids: [group.id] } })).rejects.toMatchObject({ status: 404 });
  await expect(api.createRequest({ text: 'Rice?', audiences: {} })).rejects.toMatchObject({ status: 400 });
  await expect(api.createRequest({ text: 'x'.repeat(281), audiences: { friends: true } })).rejects.toMatchObject({ status: 400 });
});

test('fulfil closes another person’s request and records the fulfiller', async () => {
  const { api, user } = await setup();
  const request = (await api.getRequests()).requests.find((entry) => entry.author_id !== user.id)!;
  await expect(api.deleteRequest(request.id)).rejects.toMatchObject({ status: 403 });
  expect((await api.fulfilRequest(request.id)).request).toMatchObject({ status: 'fulfilled', fulfilled_by: user.id, fulfilled_by_name: user.display_name });
  expect((await api.getRequests()).requests.some((entry) => entry.id === request.id)).toBe(false);
  await expect(api.fulfilRequest(request.id)).rejects.toMatchObject({ code: 'request_closed' });
  await expect(api.fulfilRequest('unknown')).rejects.toMatchObject({ status: 404 });
});

test('leaving a group removes only that audience from open requests and cancels group-only requests', async () => {
  const { api } = await setup();
  const group = (await api.getGroups()).groups[0];
  const both = (await api.createRequest({ text: 'Milk?', audiences: { friends: true, group_ids: [group.id] } })).request;
  const only = (await api.createRequest({ text: 'Rice?', audiences: { group_ids: [group.id] } })).request;
  await api.leaveGroup(group.id);
  const mine = (await api.getRequests({ mine: true })).requests;
  expect(mine.find((entry) => entry.id === both.id)).toMatchObject({ status: 'open', audiences: { friends: true, groups: [], hidden_count: 0 } });
  expect(mine.find((entry) => entry.id === only.id)).toMatchObject({ status: 'cancelled', audiences: { groups: [], hidden_count: 1 } });
});

test('reachable people deduplicate friends and group members and follow visibility changes', async () => {
  const { api, user } = await setup();
  const people = (await api.getReachablePeople()).people;
  expect(new Set(people.map((person) => person.id)).size).toBe(people.length);
  expect(people.some((person) => person.id === user.id)).toBe(false);
  expect(people.find((person) => person.display_name === 'Ana Rivera')).toMatchObject({ kind: 'friend', groups: [{ name: 'Flat 4B' }] });
  expect(people.find((person) => person.display_name === 'Maya Patel')?.kind).toBe('group_member');
  const claimed = (await api.getShare()).listings.find((entry) => entry.claimed_by_me)!;
  expect((await api.getReachablePeople(claimed.item_id)).people.every((person) => !person.is_claimer)).toBe(true);
  await api.deleteFriend(claimed.owner_id);
  expect((await api.getShare()).listings.some((entry) => entry.id === claimed.id)).toBe(false);
  await expect(api.getReachablePeople(claimed.item_id)).rejects.toMatchObject({ status: 404 });
  await expect(api.getReachablePeople('unknown')).rejects.toMatchObject({ status: 404 });
});

test('returned social data is detached from state and account deletion clears its social data', async () => {
  const { api } = await setup();
  (await api.getFriends()).friends[0].display_name = 'Changed';
  expect((await api.getFriends()).friends[0].display_name).toBe('Ana Rivera');
  const group = (await api.getGroups()).groups[0];
  (await api.getGroup(group.id)).group.members.length = 0;
  expect((await api.getGroup(group.id)).group.members).toHaveLength(3);
  await api.deleteMe();
  await expect(api.getGroups()).rejects.toMatchObject({ status: 401 });
});

test('two accounts can connect, claim, see the claimer and fulfil a request across sessions', async () => {
  const { api, user: owner } = await setup();
  const credentials = { email: 'neighbor@example.com', password: 'password123' };
  const { user: neighbor } = await api.signup({ ...credentials, display_name: 'Neighbor' });
  await api.addFriend({ email: owner.email });
  await api.login({ email: owner.email, password: 'password123' });
  expect((await api.getFriends()).incoming.some((entry) => entry.user_id === neighbor.id)).toBe(true);
  await api.acceptFriend(neighbor.id);
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples' }] });
  const { listing } = await api.createShare({ item_id: item.id, pickup: { note: 'Porch' } });
  const { request } = await api.createRequest({ text: 'Rice?', audiences: { friends: true } });
  await api.login(credentials);
  expect((await api.getShare()).listings.find((entry) => entry.id === listing.id)).toMatchObject({ pickup: null, pickup_set: true });
  await api.claimShare(listing.id);
  await api.fulfilRequest(request.id);
  await api.login({ email: owner.email, password: 'password123' });
  expect((await api.getReachablePeople(item.id)).people[0]).toMatchObject({ id: neighbor.id, is_claimer: true });
  expect((await api.getRequests({ mine: true })).requests.find((entry) => entry.id === request.id)).toMatchObject({ status: 'fulfilled', fulfilled_by: neighbor.id });
  expect((await api.removeItem(item.id, { outcome: 'donated' })).item.share?.claimed_by?.id).toBe(neighbor.id);
  await api.restoreItem(item.id);
  expect((await api.getReachablePeople(item.id)).people[0].is_claimer).toBe(true);
});

test('groups support another account joining and ownership transfer', async () => {
  const { api, user } = await setup();
  const { group } = await api.createGroup({ name: 'Neighbors' });
  const credentials = { email: 'member@example.com', password: 'password123' };
  await api.signup({ ...credentials, display_name: 'Member' });
  expect((await api.joinGroup({ invite_code: group.invite_code })).group).toMatchObject({ role: 'member', member_count: 2 });
  await api.login({ email: user.email, password: 'password123' });
  expect((await api.getGroup(group.id)).group.role).toBe('owner');
  await api.leaveGroup(group.id);
  await api.login(credentials);
  expect((await api.getGroup(group.id)).group).toMatchObject({ role: 'owner', member_count: 1 });
});

test('a failed batch rolls back new share state along with items and events', async () => {
  const { api } = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples' }] });
  const { listing } = await api.createShare({ item_id: item.id });
  await expect(api.removeBatch({ item_ids: [item.id, 'missing'], outcome: 'donated' })).rejects.toMatchObject({ status: 404 });
  expect((await api.updateShare(listing.id, { pickup: { note: 'Still available' } })).listing.status).toBe('open');
  expect((await api.getImpact()).saved.count).toBe(0);
});

test('tips reflect newly added expiring food and recorded outcomes', async () => {
  const { api } = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Milk', predicted_expiry: new Date().toISOString().slice(0, 10) }] });
  expect((await api.getTips()).tips.some((tip) => tip.code === 'expiring_soon')).toBe(true);
  await api.removeItem(item.id, { outcome: 'used' });
  expect((await api.getTips()).tips).toEqual([{ code: 'saved_recent', message: 'You used or donated 1 items in the last 30 days.' }]);
});
