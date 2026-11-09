import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError, ApiProvider, MockApiClient, type Item, type ItemsResponse } from '@/api';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { UNDO_WINDOW_MS } from '@/features/remove/use-removal-undo';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'fridge@example.com', password: 'password-for-demo', display_name: 'Demo' });
  const { items } = await api.createItems({ items: [
    { name: 'Spinach', food_group: 'veggies', storage: 'fridge', freshness: 'semi_fresh' },
    { name: 'Apples', food_group: 'fruit', storage: 'fridge', freshness: 'fresh' },
  ] });
  const screen = await render(<ApiProvider client={api}><FridgeScreen /></ApiProvider>);
  await screen.findByTestId(`fridge.item.${items[0].id}`);
  return { api, screen, item: items[0], secondItem: items[1] };
}

describe('Remove and Undo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useReducedMotion).mockReturnValue(true);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  test('thrown_out without a reason is blocked; Cancel keeps the item', async () => {
    const { api, screen, item } = await setup();
    const remove = jest.spyOn(api, 'removeItem');
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.thrown_out'));

    expect(screen.getByText('Why was it thrown out?')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('remove.cancel.button'));
    expect(screen.getByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`remove.toast.${item.id}`)).toBeNull();
  });

  test.each(['expired', 'didnt_like', 'forgot', 'other'] as const)('sends thrown_out with the %s reason', async (reason) => {
    const { api, screen, item } = await setup();
    const remove = jest.spyOn(api, 'removeItem');
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.thrown_out'));
    await fireEvent.press(screen.getByTestId(`remove.reason.${reason}`));

    expect(remove).toHaveBeenCalledWith(item.id, { outcome: 'thrown_out', waste_reason: reason });
    expect(await screen.findByTestId(`remove.toast.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  test.each(['used', 'donated'] as const)('%s hides the item; Undo restores it without a waste reason', async (outcome) => {
    const { api, screen, item } = await setup();
    const remove = jest.spyOn(api, 'removeItem');
    const restore = jest.spyOn(api, 'restoreItem');
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId(`remove.outcome.${outcome}`));

    expect(remove).toHaveBeenCalledWith(item.id, { outcome });
    expect(await screen.findByTestId(`remove.toast.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));

    expect(restore).toHaveBeenCalledWith(item.id);
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`remove.toast.${item.id}`)).toBeNull();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  test('failed removal gives error feedback and Try again gives success feedback', async () => {
    const { api, screen, item } = await setup();
    const remove = jest.spyOn(api, 'removeItem').mockRejectedValueOnce(new ApiError(0, 'upstream_unavailable', 'Offline'));
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));

    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
    await fireEvent.press(screen.getByTestId('remove.error.retry'));
    expect(await screen.findByTestId(`remove.toast.${item.id}`)).toBeTruthy();
    expect(remove).toHaveBeenNthCalledWith(2, item.id, { outcome: 'used' });
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenLastCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  test('pending removal shows skeletons, disables Cancel and prevents duplicate requests', async () => {
    const { api, screen, item } = await setup();
    const originalRemove = api.removeItem.bind(api);
    let complete: ((response: { item: Item }) => void) | undefined;
    const remove = jest.spyOn(api, 'removeItem').mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    expect(screen.getByTestId('remove.loading.skeleton')).toBeTruthy();
    expect(screen.getByTestId('remove.cancel.button')).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    await act(async () => complete?.(await originalRemove(item.id, { outcome: 'used' })));
    expect(await screen.findByTestId(`remove.toast.${item.id}`)).toBeTruthy();
  });

  test('failed Undo retains its entry and retries restoration', async () => {
    const { api, screen, item } = await setup();
    const restore = jest.spyOn(api, 'restoreItem').mockRejectedValueOnce(new ApiError(0, 'upstream_unavailable', 'Offline'));
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    await fireEvent.press(await screen.findByTestId(`remove.undo.${item.id}`));

    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(restore).toHaveBeenCalledTimes(2);
  });

  test('each removal retains Undo until its own ten-minute deadline', async () => {
    const { screen, item, secondItem } = await setup();
    jest.useFakeTimers();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    await act(async () => { jest.advanceTimersByTime(60 * 1000); });
    await fireEvent.press(screen.getByTestId(`fridge.remove.${secondItem.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    expect(screen.getByText('Nothing in your fridge yet')).toBeTruthy();

    await act(async () => { jest.advanceTimersByTime(UNDO_WINDOW_MS - 60 * 1000 - 1); });
    expect(screen.getByTestId(`remove.undo.${item.id}`)).toBeTruthy();
    expect(screen.getByTestId(`remove.undo.${secondItem.id}`)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(screen.queryByTestId(`remove.undo.${item.id}`)).toBeNull();
    expect(screen.getByTestId(`remove.undo.${secondItem.id}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`remove.undo.${secondItem.id}`));
    expect(screen.getByTestId(`fridge.item.${secondItem.id}`)).toBeTruthy();
  });

  test('a list response started before Undo cannot hide the restored item', async () => {
    const { api, screen, item } = await setup();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    await screen.findByTestId(`remove.toast.${item.id}`);
    await fireEvent.press(screen.getByTestId('fridge.storage.pantry'));
    await screen.findByText('Nothing in your pantry yet');
    const snapshot = await api.getItems({ storage: 'fridge' });
    let complete: ((response: ItemsResponse) => void) | undefined;
    jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise<ItemsResponse>((resolve) => { complete = resolve; }));
    await fireEvent.press(screen.getByTestId('fridge.storage.fridge'));
    await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));
    await act(async () => complete?.(snapshot as ItemsResponse));

    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
  });

  test('Undo in another storage keeps that list filtered and restores the original storage', async () => {
    const { screen, item } = await setup();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    await screen.findByTestId(`remove.toast.${item.id}`);
    await fireEvent.press(screen.getByTestId('fridge.storage.pantry'));
    await screen.findByText('Nothing in your pantry yet');
    await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));

    expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
    expect(screen.getByText('Nothing in your pantry yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fridge.storage.fridge'));
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
  });

  test('network time does not extend the server removal deadline', async () => {
    const { api, screen, item } = await setup();
    jest.useFakeTimers();
    const originalRemove = api.removeItem.bind(api);
    jest.spyOn(api, 'removeItem').mockImplementationOnce(async (id, input) => {
      const response = await originalRemove(id, input);
      response.item.removed_at = new Date(Date.now() - 9 * 60 * 1000).toISOString();
      return response;
    });
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    await act(async () => { jest.advanceTimersByTime(60 * 1000 - 1); });
    expect(screen.getByTestId(`remove.undo.${item.id}`)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(screen.queryByTestId(`remove.undo.${item.id}`)).toBeNull();
  });

  test('expired Undo is cleared on foregrounding after suspended timers', async () => {
    let foreground: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      foreground = listener;
      return { remove: jest.fn() };
    });
    const { screen, item } = await setup();
    jest.useFakeTimers();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    expect(screen.getByTestId(`remove.undo.${item.id}`)).toBeTruthy();
    jest.setSystemTime(Date.now() + UNDO_WINDOW_MS);
    await act(async () => foreground?.('active'));
    expect(screen.queryByTestId(`remove.undo.${item.id}`)).toBeNull();
  });

  test.each([true, false])('sheet uses the correct transition with Reduce Motion=%s', async (reduced) => {
    jest.mocked(useReducedMotion).mockReturnValue(reduced);
    const { screen, item } = await setup();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    expect(screen.getByTestId('remove.sheet.modal')).toHaveProp('animationType', reduced ? 'fade' : 'slide');
  });
});
