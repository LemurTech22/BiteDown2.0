import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StrictMode, useEffect } from 'react';
import { Text } from 'react-native';

import { ApiProvider, MockApiClient, type Item, type CreateItemInput } from '@/api';
import { NoticeProvider } from '@/components/notice/notice';
import { MoveSheet } from '@/features/fridge/move-sheet';
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

function EffectProbe({ report }: { report: (event: string) => void }) {
  useEffect(() => {
    report('setup');
    return () => report('cleanup');
  }, [report]);
  return null;
}

async function setup(strict = false, overrides: Partial<CreateItemInput> = {}) {
  const api = new MockApiClient();
  await api.signup({ email: 'save-qa@example.com', password: 'password-for-demo', display_name: 'QA' });
  const { items: [item, second] } = await api.createItems({ items: [
    { name: 'Baby spinach', category: 'produce_leafy', food_group: 'veggies', predicted_expiry: '2027-01-01', quantity: 2, unit: 'bag', ...overrides },
    { name: 'Apples', category: 'produce_hardy', food_group: 'fruit', predicted_expiry: '2027-01-02', quantity: 3, unit: 'piece' },
  ] });
  mockId = item.id;
  const store = { get: async () => null, set: async () => {}, delete: async () => {} };
  const effects: string[] = [];
  const report = (event: string) => { effects.push(event); };
  const content = (detail: boolean) => <ApiProvider client={api}><PreferencesProvider store={store}><NoticeProvider>
    {strict ? <EffectProbe report={report} /> : null}
    {detail ? <ItemDetailScreen /> : <Text>Fridge destination</Text>}
  </NoticeProvider></PreferencesProvider></ApiProvider>;
  const tree = (detail = true) => strict ? <StrictMode>{content(detail)}</StrictMode> : content(detail);
  const show = async () => {
    const screen = await render(tree());
    await screen.findByTestId('item.storage.row');
    return screen;
  };
  return { api, item, second, tree, show, effects };
}

type Screen = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['show']>>;
async function pickStorage(screen: Screen, storage = 'freezer') {
  await fireEvent.press(screen.getByTestId('item.storage.row'));
  await fireEvent.press(screen.getByTestId(`item.edit.storage.${storage}`));
}
function expectNoDeparture() {
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
}
function expectSilent(screen: Screen) {
  expectNoDeparture();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect(screen.queryByText('Old save failed')).toBeNull();
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///spinach.jpg', width: 800, height: 600 }] });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('picking a sheet option patches immediately, closes once, acknowledges once and stays in detail', async () => {
  const { api, item, show } = await setup();
  const gate = deferred<{ item: Item }>();
  const update = jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  const timer = jest.spyOn(globalThis, 'setTimeout');
  expect(screen.queryByTestId('item.save.button')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.storage.row'));
  expect(screen.queryByText('Save')).toBeNull();
  expect(screen.queryByTestId('item.edit.name.input')).toBeNull();
  expect(screen.queryByTestId('item.edit.date.quick.0')).toBeNull();
  const option = screen.getByTestId('item.edit.storage.freezer');
  await fireEvent.press(option);
  await fireEvent.press(option);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(item.id, { storage: 'freezer' });
  expect(screen.getByTestId('item.edit.sheet.cancel')).toBeDisabled();
  await fireEvent(screen.getByTestId('item.edit.sheet'), 'requestClose');
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  await act(() => gate.resolve({ item: { ...item, storage: 'freezer' } }));
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(screen.getByTestId('app.notice')).toHaveTextContent('Saved changes to Baby spinach');
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expect(timer.mock.calls.filter(([, delay]) => delay === 3000)).toHaveLength(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  expectNoDeparture();
});

test('failure stays in the same sheet with inline error; Try again repeats the exact patch', async () => {
  const { api, item, show } = await setup();
  const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new Error('Save unavailable'));
  const screen = await show();
  await pickStorage(screen);
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable');
  expect(screen.getByTestId('item.edit.retry')).toHaveTextContent('Try again');
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.edit.retry'));
  expect(update.mock.calls).toEqual([[item.id, { storage: 'freezer' }], [item.id, { storage: 'freezer' }]]);
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(screen.getByTestId('app.notice')).toHaveTextContent(`Saved changes to ${item.name}`);
  expect(jest.mocked(Haptics.notificationAsync).mock.calls.map(([kind]) => kind)).toEqual(['error', 'success']);
  expectNoDeparture();
});

test('sheet save notice survives detail removal, is polite/touch-transparent, and expires at exactly 3 seconds', async () => {
  const { show, tree } = await setup();
  const screen = await show();
  jest.useFakeTimers();
  await pickStorage(screen);
  await screen.rerender(tree(false));
  expect(screen.getAllByTestId('app.notice')).toHaveLength(1);
  expect(screen.getByTestId('app.notice')).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(screen.getByTestId('app.notice.container')).toHaveStyle({ pointerEvents: 'none' });
  await act(() => jest.advanceTimersByTime(2999));
  expect(screen.getByTestId('app.notice')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test.each(['success', 'failure'] as const)('CL-17/19: stale %s after unmount has no effects', async (outcome) => {
  const { api, item, show, tree } = await setup();
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  await pickStorage(screen);
  await screen.rerender(tree(false));
  await act(() => outcome === 'success' ? gate.resolve({ item }) : gate.reject(new Error('Old save failed')));
  expectSilent(screen);
  expect(screen.getByText('Fridge destination')).toBeTruthy();
});

test.each([[true, 'success'], [false, 'success'], [true, 'failure'], [false, 'failure']] as const)('CL-17/19: Back and teardown stay silent (history %s, %s)', async (history, outcome) => {
  const { api, item, show, tree } = await setup();
  jest.mocked(router.canGoBack).mockReturnValue(history);
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValue(gate.promise);
  const screen = await show();
  await pickStorage(screen);
  await fireEvent.press(screen.getByTestId('item.back.button'));
  if (history) expect(router.back).toHaveBeenCalledTimes(1);
  else expect(router.replace).toHaveBeenCalledWith('/fridge');
  await screen.rerender(tree(false));
  jest.mocked(router.back).mockClear(); jest.mocked(router.replace).mockClear();
  await act(() => outcome === 'success' ? gate.resolve({ item }) : gate.reject(new Error('Old save failed')));
  expectSilent(screen);
});

test.each([['success', false], ['failure', false], ['success', true], ['failure', true]] as const)('CL-17/18/19: stale %s preserves current data and permits another save (A -> B -> A: %s)', async (outcome, roundTrip) => {
  const { api, item, second, show, tree } = await setup();
  const gate = deferred<{ item: Item }>();
  const update = jest.spyOn(api, 'updateItem').mockReturnValueOnce(gate.promise);
  const screen = await show();
  await pickStorage(screen);
  mockId = second.id;
  await screen.rerender(tree()); await screen.findByText('Apples');
  if (roundTrip) {
    mockId = item.id;
    await screen.rerender(tree()); await screen.findByText(item.name);
  }
  const active = roundTrip ? item : second;
  await act(() => outcome === 'success' ? gate.resolve({ item: { ...item, name: 'Old response' } }) : gate.reject(new Error('Old save failed')));
  expectSilent(screen);
  expect(screen.getByText(active.name)).toBeTruthy();
  // Close any retained editor before making a deliberate current-visit edit.
  if (screen.queryByTestId('item.edit.sheet.cancel')) await fireEvent.press(screen.getByTestId('item.edit.sheet.cancel'));
  await pickStorage(screen, 'pantry');
  expect(update).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenLastCalledWith(active.id, { storage: 'pantry' });
  expect(screen.getByTestId('app.notice')).toHaveTextContent(`Saved changes to ${active.name}`);
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expectNoDeparture();
});

test.each(['success', 'failure'] as const)('CL-20: settling A save must preserve the B sheet after route reuse (%s)', async (outcome) => {
  const { api, item, second, show, tree } = await setup();
  const gate = deferred<{ item: Item }>();
  jest.spyOn(api, 'updateItem').mockReturnValueOnce(gate.promise);
  const screen = await show();
  await pickStorage(screen);
  mockId = second.id;
  await screen.rerender(tree()); await screen.findByText(second.name);
  // The retained sheet now receives B values. A completion must not close this visit's editor.
  expect(screen.getByTestId('item.edit.storage.fridge')).toBeTruthy();
  await act(() => outcome === 'success' ? gate.resolve({ item }) : gate.reject(new Error('Old save failed')));
  expectSilent(screen);
  expect(screen.queryByTestId('item.edit.storage.fridge')).not.toBeNull();
  expect(screen.getByText(second.name)).toBeTruthy();
});

test('pending sheet prevents cancellation or switching to another choice', async () => {
  const { api, item, show } = await setup();
  const gate = deferred<{ item: Item }>();
  const update = jest.spyOn(api, 'updateItem').mockReturnValueOnce(gate.promise);
  const screen = await show();
  await pickStorage(screen);
  expect(screen.getByTestId('item.edit.sheet.cancel')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('item.edit.sheet.cancel'));
  await fireEvent(screen.getByTestId('item.edit.sheet'), 'requestClose');
  await fireEvent.press(screen.getByTestId('item.edit.storage.pantry'));
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  expect(update).toHaveBeenCalledTimes(1);
  await act(() => gate.resolve({ item }));
});

test.each([true, false])('StrictMode replays effects and current sheet retries once (history %s)', async (history) => {
  const { api, item, show, effects } = await setup(true);
  jest.mocked(router.canGoBack).mockReturnValue(history);
  const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new Error('Retry current visit'));
  const screen = await show();
  expect(effects).toEqual(['setup', 'cleanup', 'setup']);
  await pickStorage(screen);
  expect(screen.getByRole('alert')).toHaveTextContent('Retry current visit');
  await fireEvent.press(screen.getByTestId('item.edit.retry'));
  expect(update).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(screen.getByTestId('app.notice')).toHaveTextContent(`Saved changes to ${item.name}`);
  expect(jest.mocked(Haptics.notificationAsync).mock.calls.map(([kind]) => kind)).toEqual(['error', 'success']);
  expectNoDeparture();
});

test('Check again disables summary rows while pending and never navigates or posts a save notice', async () => {
  const { api, show } = await setup();
  const scan = deferred<Awaited<ReturnType<MockApiClient['fromPhoto']>>>();
  const analyze = api.fromPhoto.bind(api);
  jest.spyOn(api, 'fromPhoto').mockReturnValue(scan.promise);
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.photo.button'));
  await fireEvent.press(screen.getByTestId('item.photo.library'));
  expect(screen.getByTestId('item.storage.row')).toBeDisabled();
  await act(async () => scan.resolve(await analyze({ uri: 'file:///spinach.jpg', mode: 'single' })));
  await waitFor(() => expect(screen.queryByTestId('item.photo.chooser')).toBeNull());
  expect(update).toHaveBeenCalledTimes(1);
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('Share on/off never navigates or publishes a sheet-save notice', async () => {
  const { api, show } = await setup();
  const create = jest.spyOn(api, 'createShare');
  const remove = jest.spyOn(api, 'deleteShare');
  const screen = await show();
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', true);
  await screen.findByText('Not claimed yet');
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', false);
  await waitFor(() => expect(screen.queryByText('Not claimed yet')).toBeNull());
  expect(create).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('pickup Done blocks duplicate requests and cancellation; completion closes only pickup', async () => {
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
  const [id, patch] = update.mock.calls[0];
  await act(async () => gate.resolve(await realUpdate(id, patch)));
  expect(screen.queryByTestId('item.pickup.sheet')).toBeNull();
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('removed items have no tappable summary rows', async () => {
  const { api, item, tree } = await setup();
  await api.removeItem(item.id, { outcome: 'used' });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await render(tree());
  await screen.findByTestId('item.removed.state');
  for (const field of ['storage', 'expiry', 'freshness', 'group', 'amount']) expect(screen.queryByTestId(`item.${field}.row`)).toBeNull();
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(update).not.toHaveBeenCalled(); expectNoDeparture();
});

test('removal elsewhere keeps a failed sheet open, retry never departs', async () => {
  const { api, item, show } = await setup();
  const screen = await show();
  await api.removeItem(item.id, { outcome: 'used' });
  await pickStorage(screen);
  expect(screen.getByRole('alert')).toHaveTextContent('Item not found.');
  await fireEvent.press(screen.getByTestId('item.edit.retry'));
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('maximum-length name saves through Name & amount and notice retains full accessible text', async () => {
  const { show } = await setup();
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.amount.row'));
  const name = 'Spinach '.repeat(25).trim();
  expect(screen.getByTestId('item.edit.name.input')).toHaveProp('maxLength', 200);
  await fireEvent.changeText(screen.getByTestId('item.edit.name.input'), name);
  await fireEvent.press(screen.getByTestId('item.edit.save'));
  const notice = screen.getByTestId('app.notice');
  expect(notice).toHaveTextContent(`Saved changes to ${name}`);
  expect(notice).toHaveProp('numberOfLines', 1);
  expect(notice.props.ellipsizeMode ?? 'tail').toBe('tail');
  expectNoDeparture();
});

test('Remove and Undo stay in detail without a sheet-save notice', async () => {
  const { api, item, show } = await setup();
  const remove = jest.spyOn(api, 'removeItem');
  const restore = jest.spyOn(api, 'restoreItem');
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.remove.button'));
  await fireEvent.press(screen.getByTestId('remove.outcome.used'));
  await screen.findByTestId('item.removed.state');
  expect(remove).toHaveBeenCalledWith(item.id, { outcome: 'used' });
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));
  await screen.findByTestId('item.storage.row');
  expect(restore).toHaveBeenCalledWith(item.id);
  expectNoDeparture(); expect(screen.queryByTestId('app.notice')).toBeNull();
});


test.each([
  ['default', false, 'fridge', 'freezer', '2099-01-01', false],
  ['user', false, 'fridge', 'freezer', '2099-01-01', true],
  ['user', true, 'fridge', 'freezer', '2099-01-01', false],
  ['default', false, 'fridge', 'freezer', '2000-01-01', true],
  ['user', true, 'fridge', 'freezer', '2000-01-01', true],
  ['default', false, 'freezer', 'fridge', '2099-01-01', false],
  ['default', false, 'fridge', 'pantry', '2099-01-01', false],
] as const)('Stored in matches Move: source %s, opt-in %s, %s -> %s, date %s', async (expiry_source, optIn, storage, destination, predicted_expiry, retained) => {
  const input = { name: 'Baby spinach', category: 'meat' as const, food_group: 'protein' as const, storage, predicted_expiry, expiry_source };
  const { api, item, show } = await setup(false, input);
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  await fireEvent.press(screen.getByTestId('item.storage.row'));
  if (expiry_source === 'user') {
    expect(screen.getByTestId('item.edit.reestimate')).toHaveProp('accessibilityState', { checked: false, disabled: false });
    if (optIn) await fireEvent.press(screen.getByTestId('item.edit.reestimate'));
  } else {
    expect(screen.queryByTestId('item.edit.reestimate')).toBeNull();
    expect(screen.getByText('Expiry updates for the new spot.')).toBeTruthy();
  }
  await fireEvent.press(screen.getByTestId(`item.edit.storage.${destination}`));
  const expectedPatch = { storage: destination, ...(optIn ? { reestimate_expiry: true } : {}) };
  expect(update).toHaveBeenLastCalledWith(item.id, expectedPatch);
  const { item: saved } = await update.mock.results[0].value;
  expect(saved.predicted_expiry === predicted_expiry).toBe(retained);
  expect(screen.getByTestId('item.storage.row').props.accessibilityLabel).toContain(destination === 'freezer' ? 'Freezer' : destination === 'pantry' ? 'Pantry' : 'Fridge');
  if (storage === 'freezer') {
    const expected = new Date(); expected.setDate(expected.getDate() + 2);
    const date = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
    expect(saved.predicted_expiry).toBe(date);
  }
  // Run the established Move sheet against an equivalent untouched item.
  await screen.unmount();
  const { items: [moveItem] } = await api.createItems({ items: [input] });
  const moved = jest.fn();
  const move = await render(<ApiProvider client={api}><MoveSheet item={moveItem} onClose={jest.fn()} onMoved={moved} /></ApiProvider>);
  if (optIn) await fireEvent.press(move.getByTestId('fridge.move.reestimate'));
  await fireEvent.press(move.getByTestId(`fridge.move.${destination}`));
  expect(update).toHaveBeenLastCalledWith(moveItem.id, expectedPatch);
  expect(moved).toHaveBeenCalledWith(expect.objectContaining({ predicted_expiry: saved.predicted_expiry, expiry_source: saved.expiry_source }));
});

test.each(['2027-01-01', '2027-01-02'] as const)('estimated badge follows unchanged / changed / reconfirmed date selection %s', async (date) => {
  const { api, item, show } = await setup(false, { expiry_source: 'default' });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).toContain('estimated');
  await fireEvent.press(screen.getByTestId('item.expiry.row'));
  await fireEvent.press(screen.getByTestId(`item.edit.date.day.${date}`));
  expect(update).toHaveBeenCalledWith(item.id, date === item.predicted_expiry ? {} : { predicted_expiry: date });
  const remainsEstimated = date === item.predicted_expiry;
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel.includes('estimated')).toBe(remainsEstimated);
  await fireEvent.press(screen.getByTestId('item.expiry.row'));
  await fireEvent.press(screen.getByTestId(`item.edit.date.day.${date}`));
  expect(update).toHaveBeenLastCalledWith(item.id, {});
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel.includes('estimated')).toBe(remainsEstimated);
});


test('an expired calendar date is selectable and saved literally, with the Expired explanation', async () => {
  const { api, item, show } = await setup(false, { predicted_expiry: '2000-02-28', expiry_source: 'default' });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).toContain('Expired');
  await fireEvent.press(screen.getByTestId('item.expiry.row'));
  await fireEvent.press(screen.getByTestId('item.edit.date.day.2000-02-29'));
  expect(update).toHaveBeenCalledWith(item.id, { predicted_expiry: '2000-02-29' });
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).toContain('Expired');
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).not.toContain('estimated');
});

test('completed sheet saves work on repeated A -> B -> A visits', async () => {
  const { api, item, second, show, tree } = await setup();
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show();
  for (const active of [item, second, item]) {
    mockId = active.id;
    await screen.rerender(tree()); await screen.findByText(active.name);
    await pickStorage(screen, 'pantry');
    expect(update).toHaveBeenLastCalledWith(active.id, { storage: 'pantry' });
    expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
    expect(screen.getByTestId('app.notice')).toHaveTextContent(`Saved changes to ${active.name}`);
  }
  expect(update).toHaveBeenCalledTimes(3);
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(3);
  expectNoDeparture();
});
