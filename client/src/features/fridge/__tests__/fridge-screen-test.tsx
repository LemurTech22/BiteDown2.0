import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import type { Item, ItemsResponse } from '@/api/types';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { groupItems } from '@/features/fridge/fridge-utils';

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
      <FridgeScreen />
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

  test('loads storage-filtered items and labels every freshness state with text', async () => {
    const api = await seededClient();
    const screen = await renderFridge(api);

    expect(await screen.findByText('Apples')).toBeTruthy();
    expect(screen.getByText('Fresh')).toBeTruthy();
    expect(screen.getByText('Use soon')).toBeTruthy();
    expect(screen.getByText('Spoiled')).toBeTruthy();
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
