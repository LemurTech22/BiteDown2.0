import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { ApiProvider, MockApiClient, type Item } from '@/api';
import { NoticeProvider } from '@/components/notice/notice';
import { ItemDetailScreen } from '@/features/item/item-detail-screen';
import { PreferencesProvider } from '@/settings/preferences';

let mockId = '';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }), router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() } }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'save-qa@example.com', password: 'password-for-demo', display_name: 'QA' });
  const { items: [item] } = await api.createItems({ items: [{ name: 'Baby spinach', category: 'produce_leafy', food_group: 'veggies', predicted_expiry: '2027-01-01', quantity: 2, unit: 'bag' }] });
  mockId = item.id;
  const values = new Map<string, string>();
  const store = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } };
  const tree = (detail = true) => <ApiProvider client={api}><PreferencesProvider store={store}><NoticeProvider>
    {detail ? <ItemDetailScreen /> : <Text>Fridge destination</Text>}
  </NoticeProvider></PreferencesProvider></ApiProvider>;
  const show = async () => {
    const screen = await render(tree());
    await screen.findByDisplayValue(item.name);
    return screen;
  };
  return { api, item, tree, show };
}

function expectNoDeparture() {
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///spinach.jpg', width: 800, height: 600 }] });
});
afterEach(() => jest.restoreAllMocks());

test.each([true, false])('rapid Save presses close once and the notice survives route unmount (history: %s)', async (history) => {
  const { api, item, tree, show } = await setup();
  jest.mocked(router.canGoBack).mockReturnValue(history);
  const gate = deferred<{ item: Item }>();
  const update = jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  const save = screen.getByTestId('item.save.button');
  await fireEvent.press(save);
  await fireEvent.press(save);
  expect(update).toHaveBeenCalledTimes(1);
  expectNoDeparture();
  await act(() => gate.resolve({ item }));
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(update).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(router.back).toHaveBeenCalledTimes(history ? 1 : 0);
  expect(router.replace).toHaveBeenCalledTimes(history ? 0 : 1);
  if (!history) expect(router.replace).toHaveBeenCalledWith('/fridge');
  await screen.rerender(tree(false));
  expect(screen.getByText('Fridge destination')).toBeTruthy();
  expect(screen.getByTestId('app.notice')).toHaveTextContent('Saved changes to Baby spinach');
});

test('a failed Save stays inline and retry succeeds once with the edited name', async () => {
  const { api, show } = await setup();
  const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new Error('Save unavailable'));
  const screen = await show();
  await fireEvent.changeText(screen.getByTestId('item.name.input'), 'Spinach for dinner');
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
  expect(screen.getByDisplayValue('Spinach for dinner')).toBeTruthy();
  expect(screen.getByTestId('item.mutation.retry')).toHaveTextContent('Try again');
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.mutation.retry'));
  expect(await screen.findByTestId('app.notice')).toHaveTextContent('Saved changes to Spinach for dinner');
  expect(update).toHaveBeenCalledTimes(2);
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(jest.mocked(Haptics.notificationAsync).mock.calls.map(([kind]) => kind)).toEqual(['error', 'success']);
});

test('pending Check again blocks Save; checking freshness never departs; later Save does', async () => {
  const { api, show } = await setup();
  const scan = deferred<Awaited<ReturnType<MockApiClient['fromPhoto']>>>();
  const analyze = api.fromPhoto.bind(api);
  jest.spyOn(api, 'fromPhoto').mockReturnValue(scan.promise);
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.photo.button'));
  await fireEvent.press(screen.getByTestId('item.photo.library'));
  expect(screen.getByTestId('item.save.button')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(update).not.toHaveBeenCalled();
  expectNoDeparture();
  await act(async () => scan.resolve(await analyze({ uri: 'file:///spinach.jpg', mode: 'single' })));
  await waitFor(() => expect(screen.queryByTestId('item.photo.chooser')).toBeNull());
  expect(update).toHaveBeenCalledTimes(1);
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(await screen.findByTestId('app.notice')).toBeTruthy();
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('pickup Done cannot dismiss while pending and never navigates; later Save does', async () => {
  const { api, item, show } = await setup();
  await api.createShare({ item_id: item.id });
  const realUpdate = api.updateShare.bind(api);
  const gate = deferred<Awaited<ReturnType<MockApiClient['updateShare']>>>();
  const update = jest.spyOn(api, 'updateShare').mockReturnValue(gate.promise);
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.pickup.add'));
  await fireEvent.changeText(screen.getByTestId('item.pickup.note'), 'On the porch');
  await fireEvent.press(screen.getByTestId('item.pickup.done'));
  await fireEvent.press(screen.getByTestId('item.pickup.done'));
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('item.pickup.cancel')).toBeDisabled();
  await fireEvent(screen.getByTestId('item.pickup.sheet'), 'requestClose');
  expect(screen.getByTestId('item.pickup.sheet')).toBeTruthy();
  expectNoDeparture();
  const [id, patch] = update.mock.calls[0];
  await act(async () => gate.resolve(await realUpdate(id, patch)));
  await waitFor(() => expect(screen.queryByTestId('item.pickup.sheet')).toBeNull());
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(await screen.findByTestId('app.notice')).toBeTruthy();
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('Share pending blocks Save and sharing never navigates', async () => {
  const { api, show } = await setup();
  const realCreate = api.createShare.bind(api);
  const gate = deferred<Awaited<ReturnType<MockApiClient['createShare']>>>();
  const create = jest.spyOn(api, 'createShare').mockReturnValue(gate.promise);
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(screen.getByTestId('item.save.button')).toBeDisabled();
  expect(update).not.toHaveBeenCalled();
  await act(async () => gate.resolve(await realCreate(create.mock.calls[0][0])));
  await screen.findByText('Not claimed yet');
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('removed items expose no Save action', async () => {
  const { api, item, tree } = await setup();
  await api.removeItem(item.id, { outcome: 'used' });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await render(tree());
  await screen.findByTestId('item.removed.state');
  expect(screen.queryByTestId('item.save.button')).toBeNull();
  expect(update).not.toHaveBeenCalled();
  expectNoDeparture();
});

test('a maximum-length food name keeps the success meaning first and truncates to one line', async () => {
  const { show } = await setup();
  const screen = await show();
  const name = 'Spinach '.repeat(25).trim();
  expect(screen.getByTestId('item.name.input')).toHaveProp('maxLength', 200);
  await fireEvent.changeText(screen.getByTestId('item.name.input'), name);
  await fireEvent.press(screen.getByTestId('item.save.button'));
  const notice = await screen.findByTestId('app.notice');
  expect(notice).toHaveTextContent(`Saved changes to ${name}`);
  expect(notice).toHaveProp('numberOfLines', 1);
  expect(notice.props.ellipsizeMode ?? 'tail').toBe('tail');
  expect(notice).toHaveProp('accessibilityLiveRegion', 'polite');
});

test('an item removed elsewhere while editing keeps Save failure inline without departing', async () => {
  const { api, item, show } = await setup();
  const screen = await show();
  await api.removeItem(item.id, { outcome: 'used' });
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Item not found.');
  expect(screen.getByTestId('item.mutation.retry')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.mutation.retry'));
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test.each([true, false])('CL-17: resolving Save after Back unmounts the detail must not navigate again (history: %s)', async (history) => {
  const { api, item, tree, show } = await setup();
  jest.mocked(router.canGoBack).mockReturnValue(history);
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  await fireEvent.press(screen.getByTestId('item.back.button'));
  await screen.rerender(tree(false));
  jest.mocked(router.back).mockClear();
  jest.mocked(router.replace).mockClear();
  await act(() => gate.resolve({ item }));
  expect(screen.getByText('Fridge destination')).toBeTruthy();
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('CL-17: a delayed Save cannot replace the item on a reused detail screen or navigate away', async () => {
  const { api, item, tree, show } = await setup();
  const { items: [second] } = await api.createItems({ items: [{ name: 'Apples', category: 'produce_hardy', food_group: 'fruit', quantity: 3, unit: 'piece' }] });
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  mockId = second.id;
  await screen.rerender(tree());
  await screen.findByDisplayValue('Apples');
  await act(() => gate.resolve({ item }));
  expect(screen.getByTestId('item.name.input')).toHaveProp('value', 'Apples');
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test.each([true, false])('Save works again after saving another route ID and returning to the same item (history: %s)', async (history) => {
  const { api, item, tree, show } = await setup();
  jest.mocked(router.canGoBack).mockReturnValue(history);
  const { items: [second] } = await api.createItems({ items: [{ name: 'Apples', category: 'produce_hardy', food_group: 'fruit', quantity: 3, unit: 'piece' }] });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  for (const [id, loadedName, editedName] of [
    [item.id, item.name, 'Spinach first save'],
    [second.id, second.name, 'Apples saved'],
    [item.id, 'Spinach first save', 'Spinach second save'],
  ]) {
    mockId = id;
    await screen.rerender(tree());
    await screen.findByDisplayValue(loadedName);
    await fireEvent.changeText(screen.getByTestId('item.name.input'), editedName);
    await fireEvent.press(screen.getByTestId('item.save.button'));
    await waitFor(() => expect(screen.getByTestId('app.notice')).toHaveTextContent(`Saved changes to ${editedName}`));
    expect(update).toHaveBeenLastCalledWith(id, expect.objectContaining({ name: editedName }));
    // A second tap before teardown still cannot resubmit this visit's Save.
    await fireEvent.press(screen.getByTestId('item.save.button'));
  }
  expect(update).toHaveBeenCalledTimes(3);
  expect(router.back).toHaveBeenCalledTimes(history ? 3 : 0);
  expect(router.replace).toHaveBeenCalledTimes(history ? 0 : 3);
  if (!history) expect(router.replace).toHaveBeenLastCalledWith('/fridge');
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(3);
});

test('CL-18: a Save from an earlier visit stays silent after routing away and back to the same item', async () => {
  const { api, item, tree, show } = await setup();
  const { items: [second] } = await api.createItems({ items: [{ name: 'Apples', category: 'produce_hardy', food_group: 'fruit', quantity: 3, unit: 'piece' }] });
  const gate = deferred<{ item: Item }>();
  const update = jest.spyOn(api, 'updateItem').mockReturnValueOnce(gate.promise);
  const screen = await show();
  await fireEvent.changeText(screen.getByTestId('item.name.input'), 'Earlier saved name');
  await fireEvent.press(screen.getByTestId('item.save.button'));
  mockId = second.id;
  await screen.rerender(tree());
  await screen.findByDisplayValue(second.name);
  mockId = item.id;
  await screen.rerender(tree());
  await screen.findByDisplayValue(item.name);
  await act(() => gate.resolve({ item: { ...item, name: 'Earlier saved name' } }));
  expect({
    name: screen.getByTestId('item.name.input').props.value,
    notice: screen.queryByTestId('app.notice')?.props.children ?? null,
    haptics: jest.mocked(Haptics.notificationAsync).mock.calls,
    back: jest.mocked(router.back).mock.calls,
    replace: jest.mocked(router.replace).mock.calls,
  }).toEqual({ name: item.name, notice: null, haptics: [], back: [], replace: [] });
  // Once the old request settles, a deliberate Save on the new visit must work.
  await fireEvent.changeText(screen.getByTestId('item.name.input'), 'Current visit name');
  await fireEvent.press(screen.getByTestId('item.save.button'));
  expect(await screen.findByTestId('app.notice')).toHaveTextContent('Saved changes to Current visit name');
  expect(update).toHaveBeenCalledTimes(2);
  expect(router.back).toHaveBeenCalledTimes(1);
});

test.each(['unmounted', 'another item'])('CL-19: a rejected Save stays silent after detail is %s', async (destination) => {
  const { api, tree, show } = await setup();
  const { items: [second] } = await api.createItems({ items: [{ name: 'Apples', category: 'produce_hardy', food_group: 'fruit', quantity: 3, unit: 'piece' }] });
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValueOnce(gate.promise);
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.save.button'));
  if (destination === 'unmounted') {
    await screen.rerender(tree(false));
  } else {
    mockId = second.id;
    await screen.rerender(tree());
    await screen.findByDisplayValue(second.name);
  }
  await act(() => gate.reject(new Error('Old item save failed')));
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect({
    staleError: Boolean(screen.queryByTestId('item.mutation.error')),
    haptics: jest.mocked(Haptics.notificationAsync).mock.calls,
  }).toEqual({ staleError: false, haptics: [] });
});

test('Remove still removes and undoes in detail without Save navigation or notice', async () => {
  const { api, item, show } = await setup();
  const remove = jest.spyOn(api, 'removeItem');
  const restore = jest.spyOn(api, 'restoreItem');
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.remove.button'));
  await fireEvent.press(screen.getByTestId('remove.outcome.used'));
  await screen.findByTestId('item.removed.state');
  expect(remove).toHaveBeenCalledWith(item.id, { outcome: 'used' });
  expect(screen.queryByTestId('remove.sheet.modal')).toBeNull();
  expect(screen.queryByTestId('item.save.button')).toBeNull();
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));
  await screen.findByDisplayValue(item.name);
  expect(restore).toHaveBeenCalledWith(item.id);
  expect(update).not.toHaveBeenCalled();
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect(screen.getByTestId('item.save.button')).not.toBeDisabled();
});
