import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { ApiProvider, MockApiClient } from '@/api';
import { MoveSheet } from '@/features/fridge/move-sheet';
import { PantryScreen } from '@/features/social/pantry-screen';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    Stack: { Screen: () => null },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});
const store = { get: async () => null, set: async () => {}, delete: async () => {} };
async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'cp18@example.com', password: 'password123', display_name: 'Contributor' });
  const { items: [item] } = await api.createItems({ items: [{ name: 'Rice', quantity: 1, unit: 'kg',
    category: 'pantry_dry', predicted_expiry: '2026-11-20' }] });
  await api.createShare({ item_id: item.id });
  return { api, item };
}
afterEach(() => jest.restoreAllMocks());

test.each(['getItems', 'getShare'] as const)('%s failure shows an error and retry restores both sections', async (method) => {
  const { api, item } = await setup();
  let reject!: (error: Error) => void;
  const request = jest.spyOn(api, method).mockImplementationOnce(() => new Promise<never>((_, fail) => { reject = fail; }));
  const screen = await render(<ApiProvider client={api}><PreferencesProvider store={store}><PantryScreen /></PreferencesProvider></ApiProvider>);
  expect(screen.getByTestId('foodPantry.loading.skeleton')).toBeTruthy();
  await act(() => reject(new Error(`${method} unavailable`)));
  expect(await screen.findByText(`${method} unavailable`)).toBeTruthy();
  expect(screen.queryByTestId('foodPantry.empty.state')).toBeNull();
  expect(screen.queryByTestId(`foodPantry.mine.${item.id}`)).toBeNull();
  await fireEvent.press(screen.getByTestId('foodPantry.error.retry'));
  const card = await screen.findByRole('button', { name: 'Rice, 2.2 lb, shared by you, Not claimed yet' });
  expect(card).toHaveStyle({ minHeight: 44 });
  expect(screen.getByRole('header', { name: "You're sharing" })).toBeTruthy();
  expect(screen.getByTestId('foodPantry.claim.listing-seed-0')).toHaveStyle({ minHeight: 44, minWidth: 44 });
  expect(request).toHaveBeenCalledTimes(2);
  await fireEvent.press(card);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: item.id } });
});

test('CL-1: the owner card announces the claimant and quantity', async () => {
  const { api } = await setup();
  const response = await api.getItems();
  if (!('items' in response)) throw new Error('Expected ungrouped items');
  const shared = response.items[0];
  jest.spyOn(api, 'getItems').mockResolvedValue({ items: [{ ...shared,
    share: { ...shared.share!, claimed_by: { id: 'friend-ana', name: 'Ana Rivera' } },
  }] });
  const screen = await render(<ApiProvider client={api}><PreferencesProvider store={store}><PantryScreen /></PreferencesProvider></ApiProvider>);
  expect(await screen.findByText('Claimed by Ana Rivera')).toBeTruthy();
  // A custom label overrides the children's text on the accessible card.
  const card = screen.getByTestId(`foodPantry.mine.${shared.id}`);
  expect(card.props.accessibilityLabel).toContain('Ana Rivera');
  expect(card.props.accessibilityLabel).toContain('2.2 lb');
});

test('Move switch stays off on retry, preserves a user date and respects reduced motion', async () => {
  const { api, item } = await setup();
  const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new Error('Move unavailable'));
  const close = jest.fn(), moved = jest.fn();
  const screen = await render(<ApiProvider client={api}><MoveSheet item={item} onClose={close} onMoved={moved} /></ApiProvider>);
  expect(screen.getByTestId('fridge.move.sheet')).toHaveProp('animationType', 'fade');
  expect(screen.getByTestId('fridge.move.reestimate')).toHaveProp('accessibilityState', { checked: false, disabled: false });
  expect(screen.queryByTestId('fridge.move.expiryNote')).toBeNull();
  expect(screen.queryByTestId('fridge.move.fridge')).toBeNull();
  const pantry = screen.getByRole('button', { name: 'Move Rice to Pantry' });
  expect(StyleSheet.flatten(pantry.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(pantry);
  expect(await screen.findByText('Move unavailable')).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('fridge.move.retry'));
  expect(update).toHaveBeenLastCalledWith(item.id, { storage: 'pantry' });
  expect(moved).toHaveBeenCalledWith(expect.objectContaining({ storage: 'pantry', predicted_expiry: item.predicted_expiry, expiry_source: 'user' }));
  expect(close).toHaveBeenCalledTimes(1);
});

test('CL-3: the web re-estimate row is one 44 pt switch that toggles from the label and row', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const { api, item } = await setup();
  const update = jest.spyOn(api, 'updateItem');
  const screen = await render(<ApiProvider client={api}><MoveSheet item={item} onClose={jest.fn()} onMoved={jest.fn()} /></ApiProvider>);
  const label = 'Re-estimate expiry for the new spot';
  const row = screen.getByTestId('fridge.move.reestimate');
  expect(screen.getByRole('switch', { name: label, checked: false })).toBe(row);
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(screen.getByText(label));
  expect(screen.getByRole('switch', { name: label, checked: true })).toBe(row);
  await fireEvent.press(row);
  expect(screen.getByRole('switch', { name: label, checked: false })).toBe(row);
  await fireEvent.press(row);
  await fireEvent.press(screen.getByTestId('fridge.move.freezer'));
  expect(update).toHaveBeenCalledWith(item.id, { storage: 'freezer', reestimate_expiry: true });
});
