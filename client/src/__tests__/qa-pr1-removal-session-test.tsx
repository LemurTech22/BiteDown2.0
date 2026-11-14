import { fireEvent, render } from '@testing-library/react-native';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
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
  expect((await api.getImpact('month')).used.count).toBe(2);
  // A committed removal must resolve to a usable Undo state, like single-item removal.
  await fireEvent.press(await screen.findByTestId('fridge.batchUndo.1'));
  for (const item of items) expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
  expect(await api.getImpact('month')).toEqual(before);
});

test('CL-11: a second demo account cannot see the first account inventory or Impact', async () => {
  const { api, items } = await seed();
  await api.removeItem(items[0].id, { outcome: 'used' });
  await api.signup({ email: 'qa-second@example.com', password: 'qa-password', display_name: 'Second' });
  // Check both independently so one mismatch cannot hide the other.
  expect({ inventory: await api.getItems(), saved: (await api.getImpact('month')).saved.count })
    .toEqual({ inventory: { items: [] }, saved: 0 });
});

test('CL-11: a second demo account cannot remove another account personal item', async () => {
  const { api, items } = await seed();
  await api.signup({ email: 'qa-second@example.com', password: 'qa-password', display_name: 'Second' });
  await expect(api.removeItem(items[0].id, { outcome: 'used' }))
    .rejects.toMatchObject({ status: 403, code: 'forbidden' });
});
