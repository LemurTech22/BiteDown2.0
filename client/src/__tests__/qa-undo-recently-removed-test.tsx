import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native';

import { ApiError, ApiProvider, MockApiClient, type Item, type ItemsResponse } from '@/api';
import RemovedRoute from '@/app/removed';
import { RecentlyRemovedScreen } from '@/features/removed/recently-removed-screen';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const NOW = new Date('2026-11-13T12:00:00Z').getTime();
const DAY = 86400000;
const ranges = ['week', 'month', 'all'] as const;

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'qa-removed@example.com', password: 'qa-password', display_name: 'QA' });
  return api;
}
function renderRemoved(api: MockApiClient) {
  return render(<ApiProvider client={api}><PreferencesProvider><RemovedRoute /></PreferencesProvider></ApiProvider>);
}
const impacts = (api: MockApiClient) => Promise.all(ranges.map((range) => api.getImpact(range)));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([false, true])('route lists newest removals across storage, excludes active/invalid/7-day-old rows; sectioned=%s', async (sectioned) => {
  expect(RemovedRoute).toBe(RecentlyRemovedScreen);
  const api = await setup();
  const { items: [base] } = await api.createItems({ items: [{ name: 'Active' }] });
  const removed = (id: string, age: number, storage: Item['storage'], outcome: Item['outcome']): Item => ({
    ...base, id, name: id, storage, outcome, removed_at: new Date(NOW - age).toISOString(),
  });
  const items = [removed('six-days', 6 * DAY + 23 * 3600000, 'freezer', 'thrown_out'),
    removed('expired', 7 * DAY + 60000, 'fridge', 'used'), removed('newest', 5 * 60000, 'pantry', 'donated'),
    removed('boundary', 7 * DAY, 'fridge', 'used'), removed('yesterday', DAY, 'fridge', 'used'),
    removed('inside', 7 * DAY - 1, 'fridge', 'used'), removed('clock-skew', -1000, 'pantry', 'used'),
    { ...base, id: 'invalid', removed_at: 'not-a-date' }, base];
  const get = jest.spyOn(api, 'getItems').mockResolvedValue(sectioned
    ? { sections: [{ food_group: 'other', items }] } : { items });
  const screen = await renderRemoved(api);
  expect(get).toHaveBeenCalledWith({ include_removed: true });
  expect(screen.getAllByTestId(/^removed.item\./).map((row) => row.props.testID)).toEqual([
    'removed.item.clock-skew', 'removed.item.newest', 'removed.item.yesterday', 'removed.item.six-days', 'removed.item.inside',
  ]);
  expect(screen.getByText('Shared · 5 min ago')).toBeTruthy();
  expect(screen.getByText('Used · Yesterday')).toBeTruthy();
  expect(screen.getByText('Thrown out · 6 days ago')).toBeTruthy();
});

test.each(['used', 'donated', 'thrown_out'] as const)('multi-day Put back of %s restores the same food and exact full Impact with other history', async (outcome) => {
  const api = await setup();
  const removedAt = NOW - (6 * DAY + 23 * 3600000);
  const { items: [other, item] } = await api.createItems({ items: [
    { name: 'Other history', est_price: 3.5, est_weight_kg: 0.5 },
    { name: 'QA apples', storage: outcome === 'used' ? 'fridge' : outcome === 'donated' ? 'pantry' : 'freezer', est_price: 8, est_weight_kg: 1.5 },
  ] });
  await api.removeItem(other.id, { outcome: 'thrown_out', waste_reason: 'forgot' });
  const share = outcome === 'donated' ? (await api.createShare({ item_id: item.id })).listing : null;
  // Both full Impact snapshots use the same observation time, so chart dates cannot mask a regression.
  const before = await impacts(api);
  jest.setSystemTime(removedAt);
  await api.removeItem(item.id, { outcome, ...(outcome === 'thrown_out' ? { waste_reason: 'expired' as const } : {}) });
  jest.setSystemTime(NOW);
  expect(await impacts(api)).not.toEqual(before);
  const restore = jest.spyOn(api, 'restoreItem');
  const screen = await renderRemoved(api);
  const button = screen.getByRole('button', { name: 'Put back QA apples' });
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(button);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(restore).toHaveBeenCalledWith(item.id);
  expect(screen.queryByTestId(`removed.item.${item.id}`)).toBeNull();
  expect(screen.getByTestId(`removed.item.${other.id}`)).toBeTruthy();
  const storage = item.storage[0].toUpperCase() + item.storage.slice(1);
  expect(screen.getByText(`QA apples is back in ${storage}`)).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('success');
  expect(await impacts(api)).toEqual(before);
  const active = (await api.getItems() as ItemsResponse).items;
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ ...item, share: share ? expect.objectContaining({ id: share.id, status: 'open' }) : null,
    removed_at: null, outcome: null, waste_reason: null, removed_after_expiry: null });
});

test('loading skeleton, retryable list error and specified empty state', async () => {
  const api = await setup();
  let reject!: (error: Error) => void;
  const get = jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await renderRemoved(api);
  expect(screen.getByTestId('removed.loading')).toBeTruthy();
  expect(screen.queryByTestId('removed.empty')).toBeNull();
  await act(() => reject(new Error('Offline')));
  expect(screen.queryByTestId('removed.loading')).toBeNull();
  expect(screen.getByTestId('removed.error')).toBeTruthy();
  expect(screen.getByText('Offline')).toBeTruthy();
  const retry = screen.getByRole('button', { name: 'Try again' });
  expect(StyleSheet.flatten(retry.props.style).minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(retry);
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('removed.error')).toBeNull();
  expect(screen.getByTestId('removed.empty')).toBeTruthy();
  expect(screen.getByText('Nothing removed in the last 7 days')).toBeTruthy();
  expect(screen.getByText('Food you use, share or throw out appears here for 7 days.')).toBeTruthy();
});

test('Put back blocks duplicate taps, preserves the row and Impact on failure, then retries successfully', async () => {
  const api = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Rice' }] });
  const before = await impacts(api);
  await api.removeItem(item.id, { outcome: 'used' });
  const afterRemoval = await impacts(api);
  let reject!: (error: Error) => void;
  const restore = jest.spyOn(api, 'restoreItem').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await renderRemoved(api);
  const button = screen.getByRole('button', { name: 'Put back Rice' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(button).toHaveProp('accessibilityState', { busy: true, disabled: true });
  await act(() => jest.advanceTimersByTime(16000));
  expect(screen.getByTestId(`removed.item.${item.id}`)).toBeTruthy();
  await act(() => reject(new Error('Restore unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Restore unavailable');
  expect(await impacts(api)).toEqual(afterRemoval);
  expect(Haptics.notificationAsync).toHaveBeenLastCalledWith('error');
  const retry = screen.getByRole('button', { name: 'Put back Rice' });
  expect(retry).toHaveTextContent('Try again');
  await fireEvent.press(retry);
  // Chart observations must use the same time as the baseline.
  jest.setSystemTime(NOW);
  expect(await impacts(api)).toEqual(before);
  expect(screen.getByTestId('removed.empty')).toBeTruthy();
});

test('a row expiring while the screen is open keeps an inline 409 and does not change Impact', async () => {
  const api = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples' }] });
  jest.setSystemTime(NOW - 7 * DAY + 1);
  await api.removeItem(item.id, { outcome: 'used' });
  jest.setSystemTime(NOW);
  const screen = await renderRemoved(api);
  jest.setSystemTime(NOW + 1);
  const before = await impacts(api);
  await fireEvent.press(screen.getByRole('button', { name: 'Put back Apples' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Items can only be restored within 7 days of removal.');
  expect(screen.getByTestId(`removed.item.${item.id}`)).toBeTruthy();
  expect(await impacts(api)).toEqual(before);
});

test.each([false, true])('mock single/batch refuses 7 days + 1 minute without changing any items or Impact; batch=%s', async (batch) => {
  const api = await setup();
  const { items } = await api.createItems({ items: [{ name: 'Old' }, { name: 'Still restorable' }] });
  jest.setSystemTime(NOW - 7 * DAY - 60000);
  await api.removeItem(items[0].id, { outcome: 'used' });
  jest.setSystemTime(NOW - 6 * DAY);
  await api.removeItem(items[1].id, { outcome: 'donated' });
  jest.setSystemTime(NOW);
  const before = { items: await api.getItems({ include_removed: true }), impact: await impacts(api) };
  await expect(batch ? api.restoreBatch(items.map((item) => item.id)) : api.restoreItem(items[0].id))
    .rejects.toMatchObject({ status: 409, code: 'restore_window_expired' } satisfies Partial<ApiError>);
  expect({ items: await api.getItems({ include_removed: true }), impact: await impacts(api) }).toEqual(before);
  await api.restoreItem(items[1].id);
});
