import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PanResponder } from 'react-native';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import type { Item, ItemsResponse } from '@/api/types';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { groupItems } from '@/features/fridge/fridge-utils';
import { ItemRow } from '@/features/fridge/item-row';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

async function renderFridge(api: MockApiClient) {
  return render(
    <ApiProvider client={api}>
      <PreferencesProvider><FridgeScreen /></PreferencesProvider>
    </ApiProvider>,
  );
}

async function seededClient() {
  const api = new MockApiClient();
  await api.signup({ email: 'demo@example.com', password: 'password-for-demo', display_name: 'Demo User' });
  await api.createItems({
    items: [
      {
        name: 'Apples',
        category: 'produce_hardy',
        food_group: 'fruit',
        storage: 'fridge',
        freshness: 'fresh',
        predicted_expiry: '2026-11-20',
      },
      {
        name: 'Bananas',
        category: 'produce_leafy',
        food_group: 'fruit',
        storage: 'fridge',
        freshness: 'semi_fresh',
        predicted_expiry: '2026-11-10',
      },
      {
        name: 'Strawberries',
        category: 'produce_leafy',
        food_group: 'fruit',
        storage: 'fridge',
        freshness: 'spoiled',
        predicted_expiry: '2026-11-09',
      },
      {
        name: 'Rice',
        category: 'pantry_dry',
        food_group: 'grains',
        storage: 'pantry',
        freshness: 'fresh',
        predicted_expiry: '2027-01-01',
      },
    ],
  });
  return api;
}

describe('Fridge', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  test('Remove stays at the row edge while a left swipe reveals one Move target', async () => {
    const api = await seededClient();
    const { items } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const item = items.find((entry) => entry.name === 'Apples')!;
    const responder = jest.spyOn(PanResponder, 'create');
    const onRemove = jest.fn();
    const onMove = jest.fn();
    const screen = await render(<ItemRow item={item} last onRemove={onRemove} onMove={onMove} />);
    const row = screen.getByTestId(`fridge.item.${item.id}`);
    const open = screen.getByTestId(`fridge.open.${item.id}`);
    const foreground = open.parent!;
    const remove = screen.getByTestId(`fridge.remove.${item.id}`);
    const move = screen.getByTestId(`fridge.move.${item.id}`);

    expect(remove).toBeVisible();
    expect(remove).toHaveProp('accessibilityLabel', `Remove ${item.name}`);
    expect(remove).toHaveStyle({ width: 44, minHeight: 44, flexShrink: 0 });
    expect(remove.parent).toBe(row);
    expect(row.children[row.children.length - 1]).toBe(remove);
    expect(move.parent!.children).toHaveLength(1);
    expect(move.parent!).toHaveStyle({ right: 44 });
    expect(open).toHaveProp('accessibilityHint', 'Swipe left for Move.');
    expect(open).toHaveProp('accessibilityLabel', 'View Apples, 1 left, expiry 2026-11-20, freshness Fresh');
    expect(foreground).toHaveStyle({ flex: 1, minWidth: 0 });
    expect(open).toHaveStyle({ flex: 1, minWidth: 0 });

    const swipe = (dx: number) => act(() => {
      const release = responder.mock.calls[responder.mock.calls.length - 1][0].onPanResponderRelease!;
      release({} as Parameters<typeof release>[0], { dx, dy: 0 } as Parameters<typeof release>[1]);
    });
    await swipe(-60);
    expect(foreground).toHaveStyle({ transform: [{ translateX: -44 }] });
    expect(remove).toBeVisible();
    expect(remove).not.toHaveStyle({ transform: [{ translateX: -44 }] });
    await fireEvent.press(move);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
    expect(foreground).not.toHaveStyle({ transform: [{ translateX: -44 }] });

    await swipe(-60);
    await swipe(60);
    expect(foreground).not.toHaveStyle({ transform: [{ translateX: -44 }] });
    await fireEvent.press(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  test('keeps Move accessible and hides row actions only during selection', async () => {
    const api = await seededClient();
    const { items: [item] } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const onRemove = jest.fn();
    const onMove = jest.fn();
    const props = { item, last: true, onRemove, onMove };
    const screen = await render(<ItemRow {...props} />);
    const open = screen.getByTestId(`fridge.open.${item.id}`);
    expect(open).toHaveProp('accessibilityActions', expect.arrayContaining([
      { name: 'move', label: `Move ${item.name} to another storage` },
    ]));
    await fireEvent(open, 'accessibilityAction', { nativeEvent: { actionName: 'move' } });
    expect(onMove).toHaveBeenCalledTimes(1);

    await screen.rerender(<ItemRow {...props} disabled />);
    expect(screen.getByTestId(`fridge.remove.${item.id}`)).toBeVisible();
    expect(screen.getByTestId(`fridge.remove.${item.id}`)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    expect(onRemove).not.toHaveBeenCalled();

    await screen.rerender(<ItemRow {...props} selecting />);
    expect(screen.queryByTestId(`fridge.remove.${item.id}`)).toBeNull();
    expect(screen.queryByTestId(`fridge.move.${item.id}`)).toBeNull();
    expect(screen.getByTestId(`fridge.select.${item.id}`)).toBeVisible();
    expect(screen.getByTestId(`fridge.open.${item.id}`).props.accessibilityActions).toBeUndefined();
  });

  test('row taps open item detail and Search filters the list', async () => {
    const api = await seededClient();
    const { items } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const item = items.find((entry) => entry.name === 'Apples')!;
    const screen = await renderFridge(api);
    await screen.findByTestId(`fridge.item.${item.id}`);
    await fireEvent.press(screen.getByTestId(`fridge.open.${item.id}`));
    expect(router.push).toHaveBeenCalledWith(`/item/${item.id}`);
    await fireEvent.changeText(screen.getByTestId('fridge.search.input'), 'apple');
    expect(screen.getByText('Apples')).toBeTruthy();
    expect(screen.queryByText('Bananas')).toBeNull();
  });

  test.each(['used', 'donated'] as const)('selects food, marks the batch %s and Undo restores impact exactly', async (outcome) => {
    const api = await seededClient();
    const { items } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const before = await api.getImpact('month');
    const remove = jest.spyOn(api, 'removeBatch');
    const restore = jest.spyOn(api, 'restoreBatch');
    const screen = await renderFridge(api);
    await screen.findByText('Apples');
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    expect(screen.getByTestId('fridge.batch.used')).toBeDisabled();
    expect(screen.getByTestId('fridge.selection.modal')).toHaveProp('animationType', 'fade');
    for (const item of items.slice(0, 2)) await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByTestId(`fridge.select.${items[0].id}`)).toHaveProp('accessibilityState', expect.objectContaining({ checked: true }));
    await fireEvent.press(screen.getByTestId(`fridge.batch.${outcome}`));
    expect(remove).toHaveBeenCalledWith({ item_ids: items.slice(0, 2).map((item) => item.id), outcome });
    expect(await screen.findByText(`2 items marked ${outcome === 'used' ? 'used' : 'shared'}`)).toBeTruthy();
    expect(screen.queryByTestId('fridge.selection.modal')).toBeNull();
    expect(screen.queryByTestId(`fridge.item.${items[0].id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('fridge.batchUndo.1'));
    expect(restore).toHaveBeenCalledWith(items.slice(0, 2).map((item) => item.id));
    expect(await screen.findByTestId(`fridge.item.${items[0].id}`)).toBeTruthy();
    expect(await api.getImpact('month')).toEqual(before);
  });

  test('batch removal errors preserve selection and retry the chosen outcome', async () => {
    const api = await seededClient();
    const { items: [item] } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const remove = jest.spyOn(api, 'removeBatch').mockRejectedValueOnce(new Error('Batch failed'));
    const screen = await renderFridge(api);
    await screen.findByText('Apples');
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.batch.donated'));
    expect(await screen.findByText('Batch failed')).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fridge.batch.retry'));
    expect(await screen.findByText('1 items marked shared')).toBeTruthy();
    expect(remove).toHaveBeenLastCalledWith({ item_ids: [item.id], outcome: 'donated' });
  });

  test('batch Undo errors stay available for Try again', async () => {
    const api = await seededClient();
    const { items: [item] } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const restore = jest.spyOn(api, 'restoreBatch').mockRejectedValueOnce(new Error('Undo failed'));
    const screen = await renderFridge(api);
    await screen.findByText('Apples');
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.batch.used'));
    await fireEvent.press(screen.getByTestId('fridge.batchUndo.1'));
    expect(await screen.findByText('Undo failed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fridge.batchUndo.1'));
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(restore).toHaveBeenCalledTimes(2);
  });

  test('pending batch blocks duplicate removals and Android back; Done cancels selection', async () => {
    const api = await seededClient();
    const { items: [item] } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    let reject!: (error: Error) => void;
    const remove = jest.spyOn(api, 'removeBatch').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const screen = await renderFridge(api);
    await screen.findByText('Apples');
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.batch.used'));
    expect(screen.getByTestId('fridge.batch.loading')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fridge.batch.used'));
    await fireEvent(screen.getByTestId('fridge.selection.modal'), 'requestClose');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fridge.selection.modal')).toBeTruthy();
    await act(() => reject(new Error('Offline')));
    await fireEvent.press(screen.getByTestId('fridge.selection.done'));
    expect(screen.queryByTestId('fridge.selection.modal')).toBeNull();
    expect(screen.getByTestId(`fridge.item.${item.id}`)).toBeTruthy();
  });

  test('switching storage clears selections and never removes hidden storage items', async () => {
    const api = await seededClient();
    const { items: [item] } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const screen = await renderFridge(api);
    await screen.findByText('Apples');
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.storage.pantry'));
    await screen.findByText('Rice');
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect(screen.getByTestId('fridge.batch.used')).toBeDisabled();
  });

  test.each(['pantry', 'freezer'] as const)('moves an item to %s and removes it from the current list', async (storage) => {
    const api = await seededClient();
    const response = await api.getItems({ storage: 'fridge' });
    const item = (response as ItemsResponse).items.find((item) => item.name === 'Apples')!;
    const update = jest.spyOn(api, 'updateItem');
    const screen = await renderFridge(api);
    await screen.findByTestId(`fridge.item.${item.id}`);
    await fireEvent.press(screen.getByTestId(`fridge.move.${item.id}`));
    expect(screen.queryByTestId('fridge.move.fridge')).toBeNull();
    expect(screen.getByTestId('fridge.move.sheet')).toHaveProp('animationType', 'fade');
    await fireEvent.press(screen.getByTestId(`fridge.move.${storage}`));
    await waitFor(() => expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(item.id, { storage });
    expect(screen.getByText(storage === 'pantry' ? 'Moved to Pantry' : 'Moved to Freezer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`fridge.storage.${storage}`));
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    // Pantry and freezer items offer a way back to the fridge.
    await fireEvent.press(screen.getByTestId(`fridge.move.${item.id}`));
    expect(screen.queryByTestId(`fridge.move.${storage}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('fridge.move.fridge'));
    await waitFor(() => expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull());
    expect(update).toHaveBeenLastCalledWith(item.id, { storage: 'fridge' });
  });

  test('a move error keeps the item and retries the selected destination', async () => {
    const api = await seededClient();
    const { items } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const item = items[0];
    const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Move failed.'));
    const screen = await renderFridge(api);
    await screen.findByTestId(`fridge.item.${item.id}`);
    await fireEvent.press(screen.getByTestId(`fridge.move.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.move.pantry'));
    expect(await screen.findByText('Move failed.')).toBeTruthy();
    expect(screen.queryByTestId('fridge.move.confirmation')).toBeNull();
    expect(screen.getByTestId(`fridge.item.${item.id}`, { includeHiddenElements: true })).toBeTruthy();
    expect((await api.getItems({ storage: 'fridge' }) as ItemsResponse).items.some((value) => value.id === item.id)).toBe(true);
    await fireEvent.press(screen.getByTestId('fridge.move.retry'));
    await waitFor(() => expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull());
    expect(update).toHaveBeenNthCalledWith(2, item.id, { storage: 'pantry' });
  });

  test('shows a skeleton during a move, sends once, and permits cancel after failure', async () => {
    const api = await seededClient();
    const { items } = await api.getItems({ storage: 'fridge' }) as ItemsResponse;
    const item = items[0];
    let rejectMove!: (reason: Error) => void;
    const update = jest.spyOn(api, 'updateItem').mockImplementationOnce(() => new Promise((_, reject) => { rejectMove = reject; }));
    const screen = await renderFridge(api);
    await screen.findByTestId(`fridge.item.${item.id}`);
    await fireEvent.press(screen.getByTestId(`fridge.move.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.move.pantry'));
    expect(screen.getByTestId('fridge.move.skeleton')).toBeTruthy();
    await fireEvent(screen.getByTestId('fridge.move.sheet'), 'requestClose');
    expect(screen.getByTestId('fridge.move.skeleton')).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(1);
    await act(() => rejectMove(new ApiError(503, 'unavailable', 'Move failed.')));
    await fireEvent.press(screen.getByTestId('fridge.move.cancel'));
    expect(screen.getByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId('fridge.move.sheet')).toBeNull();
  });

  test('loads storage-filtered items and gives each row one expiry or freshness status', async () => {
    const api = await seededClient();
    const screen = await renderFridge(api);

    expect(await screen.findByText('Apples')).toBeTruthy();
    expect(screen.queryByText('Fresh')).toBeNull();
    expect(screen.getByText('Use soon')).toBeTruthy();
    expect(screen.getByText('Looks off')).toBeTruthy();
    expect(screen.queryByText('Rice')).toBeNull();

    await fireEvent.press(screen.getByTestId('fridge.storage.pantry'));
    expect(await screen.findByText('Rice')).toBeTruthy();
    expect(screen.queryByText('Apples')).toBeNull();

    await fireEvent.press(screen.getByTestId('fridge.storage.freezer'));
    expect(await screen.findByText('Nothing in your freezer yet')).toBeTruthy();
  });

  test('shows an empty state and opens the Add modal', async () => {
    const api = new MockApiClient();
    await api.signup({ email: 'demo@example.com', password: 'password-for-demo', display_name: 'Demo User' });
    const screen = await renderFridge(api);

    expect(await screen.findByText('Nothing in your fridge yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('fridge.empty.add'));
    expect(router.push).toHaveBeenCalledWith('/add-modal');
  });

  test('shows a loading skeleton and then an error with a working retry', async () => {
    const api = await seededClient();
    let rejectItems: ((error: ApiError) => void) | undefined;
    const getItems = jest.spyOn(api, 'getItems');
    getItems.mockImplementationOnce(
      () =>
        new Promise<ItemsResponse>((_resolve, reject) => {
          rejectItems = reject;
        }),
    );
    const screen = await renderFridge(api);

    expect(screen.getByTestId('fridge.loading.skeleton')).toBeTruthy();
    await act(async () => rejectItems?.(new ApiError(0, 'upstream_unavailable', 'Server unavailable')));
    expect(await screen.findByTestId('fridge.error.state')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('fridge.error.retry'));
    expect(await screen.findByText('Apples')).toBeTruthy();
  });

  test('ignores a late response after changing storage', async () => {
    const api = await seededClient();
    const original = await api.getItems({ storage: 'fridge' });
    let resolveItems: ((response: ItemsResponse) => void) | undefined;
    jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise<ItemsResponse>((resolve) => {
      resolveItems = resolve;
    }));
    const screen = await renderFridge(api);
    await fireEvent.press(screen.getByTestId('fridge.storage.pantry'));
    expect(await screen.findByText('Rice')).toBeTruthy();

    await act(async () => resolveItems?.(original as ItemsResponse));
    expect(screen.queryByText('Apples')).toBeNull();
    expect(screen.getByText('Rice')).toBeTruthy();
  });

  test('groups by food group and sorts expiry dates with unknown dates last', async () => {
    const api = await seededClient();
    const response = await api.getItems();
    const items = (response as ItemsResponse).items;
    const unknown: Item = { ...items[0], id: 'unknown', food_group: 'fruit', predicted_expiry: null };
    const sections = groupItems([unknown, ...items]);

    expect(sections.map((section) => section.label)).toEqual(['Fruit', 'Grains']);
    expect(sections[0].items.map((item) => item.name)).toEqual([
      'Strawberries', 'Bananas', 'Apples', unknown.name,
    ]);
  });
});
