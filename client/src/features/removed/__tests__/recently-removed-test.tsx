import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { ApiProvider, MockApiClient, type Item, type ItemsResponse } from '@/api';
import { RESTORE_WINDOW_MS } from '@/api/removal-window';
import { RecentlyRemovedScreen } from '@/features/removed/recently-removed-screen';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'removed@example.com', password: 'password123', display_name: 'Demo' });
  return api;
}

function renderRemoved(api: MockApiClient) {
  return render(<ApiProvider client={api}><PreferencesProvider><RecentlyRemovedScreen /></PreferencesProvider></ApiProvider>);
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([false, true])('filters seven days and orders newest first, sectioned=%s', async (sectioned) => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00Z'));
  const api = await setup();
  const { items: [base] } = await api.createItems({ items: [{ name: 'Base' }] });
  const removed = (id: string, age: number): Item => ({ ...base, id, name: id, removed_at: new Date(Date.now() - age).toISOString(), outcome: 'used' });
  const items = [removed('old', RESTORE_WINDOW_MS + 1), removed('three-days', 3 * 86400000),
    removed('boundary', RESTORE_WINDOW_MS), removed('yesterday', 86400000), removed('newest', 2 * 3600000),
    removed('just-inside', RESTORE_WINDOW_MS - 1), removed('future', -1000), { ...base, id: 'active' }];
  const get = jest.spyOn(api, 'getItems').mockResolvedValue(sectioned ? { sections: [{ food_group: 'other', items }] } : { items });
  const screen = await renderRemoved(api);
  expect(get).toHaveBeenCalledWith({ include_removed: true });
  expect(screen.getAllByTestId(/^removed.item\./).map((row) => row.props.testID)).toEqual([
    // A removal stamped slightly ahead of the device clock (server skew) still shows, first.
    'removed.item.future', 'removed.item.newest', 'removed.item.yesterday', 'removed.item.three-days', 'removed.item.just-inside',
  ]);
  expect(screen.getByText('Used · 2 h ago')).toBeTruthy();
  expect(screen.getByText('Used · Yesterday')).toBeTruthy();
  expect(screen.getByText('Used · 3 days ago')).toBeTruthy();
});

test.each(['used', 'donated', 'thrown_out'] as const)('Put back reverses %s Impact exactly and announces original storage', async (outcome) => {
  const api = await setup();
  const storage = outcome === 'used' ? 'fridge' : outcome === 'donated' ? 'pantry' : 'freezer';
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples', storage, est_weight_kg: 1, est_price: 4 }] });
  const before = await api.getImpact('all');
  await api.removeItem(item.id, { outcome, ...(outcome === 'thrown_out' ? { waste_reason: 'expired' as const } : {}) });
  const restore = jest.spyOn(api, 'restoreItem');
  const screen = await renderRemoved(api);
  await screen.findByTestId(`removed.item.${item.id}`);
  expect(screen.getByText(new RegExp(`^${outcome === 'used' ? 'Used' : outcome === 'donated' ? 'Shared' : 'Thrown out'} ·`))).toBeTruthy();
  const button = screen.getByTestId(`removed.putBack.${item.id}`);
  expect(button).toHaveProp('accessibilityLabel', 'Put back Apples');
  await fireEvent.press(button);
  expect(restore).toHaveBeenCalledWith(item.id);
  expect(screen.queryByTestId(`removed.item.${item.id}`)).toBeNull();
  expect(screen.getByText(`Apples is back in ${storage[0].toUpperCase()}${storage.slice(1)}`)).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('success');
  expect(await api.getImpact('all')).toEqual(before);
  expect((await api.getItems() as ItemsResponse).items).toContainEqual(item);
});

test('loading skeleton becomes the specified empty state', async () => {
  const api = await setup();
  let resolve!: (value: ItemsResponse) => void;
  jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const screen = await renderRemoved(api);
  expect(screen.getByTestId('removed.loading')).toBeTruthy();
  await act(() => resolve({ items: [] }));
  expect(screen.queryByTestId('removed.loading')).toBeNull();
  expect(screen.getByTestId('removed.empty')).toBeTruthy();
  expect(screen.getByText('Nothing removed in the last 7 days')).toBeTruthy();
  expect(screen.getByText('Food you use, share or throw out appears here for 7 days.')).toBeTruthy();
});

test('list errors offer a working retry', async () => {
  const api = await setup();
  const get = jest.spyOn(api, 'getItems').mockRejectedValueOnce(new Error('Offline'));
  const screen = await renderRemoved(api);
  expect(await screen.findByTestId('removed.error')).toBeTruthy();
  expect(screen.getByText('Offline')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('removed.retry'));
  expect(await screen.findByTestId('removed.empty')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

test('row restore blocks duplicates, stays on error and retries', async () => {
  const api = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Rice', storage: 'pantry' }] });
  await api.removeItem(item.id, { outcome: 'used' });
  let reject!: (error: Error) => void;
  const restore = jest.spyOn(api, 'restoreItem').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await renderRemoved(api);
  const button = await screen.findByTestId(`removed.putBack.${item.id}`);
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(() => reject(new Error('Restore failed')));
  expect(screen.getByText('Restore failed')).toBeTruthy();
  expect(screen.getByText('Try again')).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('error');
  await fireEvent.press(screen.getByTestId(`removed.putBack.${item.id}`));
  expect(restore).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId(`removed.item.${item.id}`)).toBeNull();
});
