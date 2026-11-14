import { act, fireEvent, render } from '@testing-library/react-native';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { RecentlyRemovedScreen } from '@/features/removed/recently-removed-screen';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

async function seed() {
  const api = new MockApiClient();
  await api.signup({ email: 'qa-first@example.com', password: 'qa-password', display_name: 'First' });
  const { items } = await api.createItems({ items: [
    { name: 'QA apples', est_weight_kg: 1, est_price: 4 },
    { name: 'QA milk', est_weight_kg: 0.5, est_price: 2 },
  ] });
  return { api, items };
}

afterEach(() => jest.restoreAllMocks());

test('CL-10: lost batch-removal response can recover on retry and Undo restores Impact exactly', async () => {
  const { api, items } = await seed();
  const before = await api.getImpact('month');
  const originalRemove = api.removeBatch.bind(api);
  const remove = jest.spyOn(api, 'removeBatch').mockImplementationOnce(async (input) => {
    await originalRemove(input);
    throw new ApiError(0, 'upstream_unavailable', 'Batch response lost');
  });
  const screen = await render(<ApiProvider client={api}><PreferencesProvider><FridgeScreen /></PreferencesProvider></ApiProvider>);
  await screen.findByTestId(`fridge.item.${items[0].id}`);
  await fireEvent.press(screen.getByTestId('fridge.selection.start'));
  for (const item of items) await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
  await fireEvent.press(screen.getByTestId('fridge.batch.used'));
  await screen.findByText('Batch response lost');
  expect((await api.getImpact('month')).used.count).toBe(2);

  await fireEvent.press(screen.getByTestId('fridge.batch.retry'));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('fridge.selection.bar')).toBeNull();
  for (const item of items) expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
  expect((await api.getImpact('month')).used.count).toBe(2);
  // A committed removal must resolve to a usable Undo state, like single-item removal.
  await fireEvent.press(await screen.findByTestId('fridge.batchUndo.1'));
  for (const item of items) expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
  expect(await api.getImpact('month')).toEqual(before);
});

test.each(['used', 'donated'] as const)('CL-10: a partial batch 409 keeps active items selected for %s retry and both removals restorable', async (outcome) => {
  const { api, items } = await seed();
  const before = await api.getImpact('month');
  const remove = jest.spyOn(api, 'removeBatch');
  const restore = jest.spyOn(api, 'restoreBatch');
  const getItems = jest.spyOn(api, 'getItems');
  const screen = await render(<ApiProvider client={api}><PreferencesProvider><FridgeScreen /></PreferencesProvider></ApiProvider>);
  await screen.findByTestId(`fridge.item.${items[0].id}`);
  await fireEvent.press(screen.getByTestId('fridge.selection.start'));
  for (const item of items) await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
  // Another request removes just one item after the screen loaded; the batch must write nothing.
  await act(async () => { await api.removeItem(items[0].id, { outcome }); });
  const afterExternalRemoval = await api.getImpact('month');
  await fireEvent.press(screen.getByTestId(`fridge.batch.${outcome}`));
  expect(await screen.findByText('Some items were already removed. Try again to remove the rest.')).toBeTruthy();
  await expect(remove.mock.results[0].value).rejects.toMatchObject({ status: 409, code: 'already_removed' });
  expect(getItems).toHaveBeenLastCalledWith({ storage: 'fridge', include_removed: true });
  expect(screen.queryByTestId(`fridge.item.${items[0].id}`)).toBeNull();
  expect(screen.getByTestId(`fridge.select.${items[1].id}`)).toHaveProp('accessibilityState', { checked: true, disabled: false });
  expect(screen.getByTestId('fridge.selection.count')).toHaveTextContent('1 selected');
  expect(screen.getByTestId('fridge.batchUndo.1')).toBeTruthy();
  expect(await api.getImpact('month')).toEqual(afterExternalRemoval);

  await fireEvent.press(screen.getByTestId('fridge.batch.retry'));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenLastCalledWith({ item_ids: [items[1].id], outcome });
  expect(screen.queryByTestId('fridge.selection.bar')).toBeNull();
  expect(screen.queryByText('Some items were already removed. Try again to remove the rest.')).toBeNull();
  for (const item of items) expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
  expect((await api.getImpact('month'))[outcome].count).toBe(2);
  expect(screen.queryByTestId('fridge.batchUndo.1')).toBeNull();
  expect(screen.getAllByTestId(/^fridge.batchToast\./)).toHaveLength(1);

  await fireEvent.press(await screen.findByTestId('fridge.batchUndo.2'));
  expect(restore).toHaveBeenLastCalledWith([items[1].id]);
  expect(await screen.findByTestId(`fridge.item.${items[1].id}`)).toBeTruthy();
  expect(await api.getImpact('month')).toEqual(afterExternalRemoval);
  // The newest removal replaced the older panel; Recently removed retains its restore path.
  await screen.unmount();
  const history = await render(<ApiProvider client={api}><PreferencesProvider><RecentlyRemovedScreen /></PreferencesProvider></ApiProvider>);
  await fireEvent.press(await history.findByTestId(`removed.putBack.${items[0].id}`));
  expect(history.queryByTestId(`removed.item.${items[0].id}`)).toBeNull();
  expect(await api.getItems()).toEqual({ items });
  expect(await api.getImpact('month')).toEqual(before);
});

test('CL-11: a second demo account cannot see the first account inventory or Impact', async () => {
  const { api, items } = await seed();
  const ranges = ['week', 'month', 'all'] as const;
  const emptyImpact = await Promise.all(ranges.map((range) => api.getImpact(range)));
  await api.removeItem(items[0].id, { outcome: 'used' });
  await api.signup({ email: 'qa-second@example.com', password: 'qa-password', display_name: 'Second' });
  // Check both independently so one mismatch cannot hide the other.
  expect({ inventory: await api.getItems(), saved: (await api.getImpact('month')).saved.count })
    .toEqual({ inventory: { items: [] }, saved: 0 });
  expect(await api.getItems({ include_removed: true, group_by: 'food_group' })).toEqual({ sections: [] });
  for (const [index, range] of ranges.entries()) expect(await api.getImpact(range)).toEqual(emptyImpact[index]);
  await api.login({ email: 'qa-first@example.com', password: 'qa-password' });
  expect(await api.getItems()).toEqual({ items: [items[1]] });
  expect((await api.getImpact()).used.count).toBe(1);
});

test('CL-11: a second demo account cannot remove another account personal item', async () => {
  const { api, items } = await seed();
  await api.signup({ email: 'qa-second@example.com', password: 'qa-password', display_name: 'Second' });
  await expect(api.removeItem(items[0].id, { outcome: 'used' }))
    .rejects.toMatchObject({ status: 403, code: 'forbidden' });
});

test('fresh demo account still seeds friends, group food, shares and requests with empty personal Impact', async () => {
  const api = new MockApiClient();
  const { user } = await api.signup({ email: 'qa-fresh@example.com', password: 'qa-password', display_name: 'Fresh' });
  const before = await api.getImpact();
  expect((await api.getFriends()).friends).toHaveLength(2);
  const { groups } = await api.getGroups();
  expect(groups).toHaveLength(1);
  expect((await api.getGroup(groups[0].id)).group.members).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: user.id })]));
  const { items: groupItems } = await api.getGroupPantry(groups[0].id);
  expect(groupItems).toHaveLength(1);
  expect((await api.getShare()).listings).toHaveLength(2);
  expect((await api.getRequests()).requests).toHaveLength(2);
  expect(await api.getItems()).toEqual({ items: [] });
  expect(await api.getImpact()).toEqual(before);
  expect(before.saved.count).toBe(0);
  await api.removeItem(groupItems[0].id, { outcome: 'used' });
  expect((await api.getImpact()).used.count).toBe(1);
  await api.restoreItem(groupItems[0].id);
  expect((await api.getGroupPantry(groups[0].id)).items).toEqual(groupItems);
  expect(await api.getImpact()).toEqual(before);
});
