import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';

import { ApiProvider, MockApiClient } from '@/api';
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

const NOW = new Date('2026-11-13T12:00:00Z').getTime();
type Screen = Awaited<ReturnType<typeof render>>;

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'qa-undo@example.com', password: 'qa-password', display_name: 'QA' });
  const { items } = await api.createItems({ items: ['Apples', 'Pears', 'Grapes', 'Milk', 'Rice'].map((name) => ({ name, est_price: 4, est_weight_kg: 0.5 })) });
  const before = await api.getImpact('all');
  const screen = await render(<ApiProvider client={api}><PreferencesProvider><FridgeScreen /></PreferencesProvider></ApiProvider>);
  return { api, items, before, screen };
}
async function removeSingle(screen: Screen, id: string) {
  await fireEvent.press(screen.getByTestId(`fridge.remove.${id}`));
  await fireEvent.press(screen.getByTestId('remove.outcome.used'));
}
async function removeBatch(screen: Screen, ids: string[]) {
  await fireEvent.press(screen.getByTestId('fridge.selection.start'));
  for (const id of ids) await fireEvent.press(screen.getByTestId(`fridge.select.${id}`));
  await fireEvent.press(screen.getByTestId('fridge.batch.used'));
}
function history(api: MockApiClient) {
  return render(<ApiProvider client={api}><PreferencesProvider><RecentlyRemovedScreen /></PreferencesProvider></ApiProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('new removal replaces the prior panel in every single/batch combination; all older foods stay restorable', async () => {
  const { api, items, before, screen } = await setup();
  await removeSingle(screen, items[0].id);
  await act(() => jest.advanceTimersByTime(7000));
  await removeSingle(screen, items[1].id);
  expect(screen.queryByTestId(`remove.toast.${items[0].id}`)).toBeNull();
  await act(() => jest.advanceTimersByTime(1000));
  // The old deadline must not dismiss its replacement.
  expect(screen.getByTestId(`remove.toast.${items[1].id}`)).toBeTruthy();
  await removeBatch(screen, [items[2].id]);
  expect(screen.queryAllByTestId(/^remove.toast\./)).toHaveLength(0);
  expect(screen.getAllByTestId(/^fridge.batchToast\./)).toHaveLength(1);
  await removeBatch(screen, [items[3].id]);
  expect(screen.queryByTestId('fridge.batchToast.1')).toBeNull();
  expect(screen.getByTestId('fridge.batchToast.2')).toBeTruthy();
  await removeSingle(screen, items[4].id);
  expect(screen.queryAllByTestId(/^fridge.batchToast\./)).toHaveLength(0);
  expect(screen.getAllByTestId(/^remove.toast\./)).toHaveLength(1);
  await fireEvent.press(screen.getByTestId(`remove.undo.${items[4].id}`));
  expect(screen.queryAllByTestId(/^remove.toast\./)).toHaveLength(0);
  expect((await api.getImpact('all')).used.count).toBe(4);
  const entry = screen.getByRole('button', { name: 'Recently removed' });
  expect(entry).toHaveStyle({ minWidth: 44, minHeight: 44 });
  await fireEvent.press(entry);
  expect(router.push).toHaveBeenCalledWith('/removed');
  await screen.unmount();
  const removed = await history(api);
  expect(removed.getAllByTestId(/^removed.item\./)).toHaveLength(4);
  for (const item of items.slice(0, 4)) await fireEvent.press(removed.getByRole('button', { name: `Put back ${item.name}` }));
  jest.setSystemTime(NOW);
  expect(await api.getImpact('all')).toEqual(before);
  expect(await api.getItems()).toEqual({ items });
  expect(removed.getByTestId('removed.empty')).toBeTruthy();
});

test.each(['single', 'batch'] as const)('%s Undo stays pending and failed beyond eight seconds; retry restores exact Impact', async (kind) => {
  const { api, items, before, screen } = await setup();
  let reject!: (error: Error) => void;
  const restore = kind === 'single'
    ? jest.spyOn(api, 'restoreItem').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
    : jest.spyOn(api, 'restoreBatch').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  if (kind === 'single') await removeSingle(screen, items[0].id);
  else await removeBatch(screen, [items[0].id, items[1].id]);
  const panelId = kind === 'single' ? `remove.toast.${items[0].id}` : 'fridge.batchToast.1';
  const undoId = kind === 'single' ? `remove.undo.${items[0].id}` : 'fridge.batchUndo.1';
  await act(() => jest.advanceTimersByTime(7000));
  await fireEvent.press(screen.getByTestId(undoId));
  await fireEvent.press(screen.getByTestId(undoId));
  await act(() => jest.advanceTimersByTime(30000));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId(panelId)).toBeTruthy();
  expect(screen.getByTestId(undoId)).toBeDisabled();
  await act(() => reject(new Error('Offline')));
  await act(() => jest.advanceTimersByTime(30000));
  expect(screen.getByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByTestId(undoId)).toHaveTextContent('Try again');
  await fireEvent.press(screen.getByTestId(undoId));
  expect(restore).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId(panelId)).toBeNull();
  jest.setSystemTime(NOW);
  expect(await api.getImpact('all')).toEqual(before);
});

test.each(['single', 'batch'] as const)('%s Dismiss preserves removal and a working Recently removed entry', async (kind) => {
  const { api, items, before, screen } = await setup();
  if (kind === 'single') await removeSingle(screen, items[0].id);
  else await removeBatch(screen, [items[0].id, items[1].id]);
  const afterRemoval = await api.getImpact('all');
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryAllByTestId(/^(remove.toast|fridge.batchToast)\./)).toHaveLength(0);
  expect(await api.getImpact('all')).toEqual(afterRemoval);
  await screen.unmount();
  const removed = await history(api);
  for (const item of items.slice(0, kind === 'single' ? 1 : 2)) {
    await fireEvent.press(removed.getByRole('button', { name: `Put back ${item.name}` }));
  }
  expect(await api.getImpact('all')).toEqual(before);
});

test('Fridge header offers Recently removed with empty inventory', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'qa-empty@example.com', password: 'qa-password', display_name: 'QA' });
  const screen = await render(<ApiProvider client={api}><PreferencesProvider><FridgeScreen /></PreferencesProvider></ApiProvider>);
  expect(screen.getByText('Nothing in your fridge yet')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Recently removed' }));
  expect(router.push).toHaveBeenCalledWith('/removed');
});
