import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiProvider, MockApiClient, type ItemsResponse } from '@/api';
import { HomeScreen } from '@/features/home/home-screen';
import { PreferencesProvider } from '@/settings/preferences';
import { deviceStore } from '@/storage/key-value-store';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { router: { push: jest.fn() }, useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});
jest.mock('@/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'home-user', display_name: 'Priya Shah' } }) }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/storage/key-value-store', () => {
  const values = new Map<string, string>();
  return { deviceStore: { get: jest.fn(async (key: string) => values.get(key) ?? null), set: jest.fn(async (key: string, value: string) => { values.set(key, value); }), delete: jest.fn(async (key: string) => { values.delete(key); }) } };
});

async function client(empty = false) {
  const api = new MockApiClient();
  await api.signup({ email: 'home@example.com', password: 'password-for-demo', display_name: 'Priya' });
  if (!empty) await api.createItems({ items: [
    { name: 'Apples', food_group: 'fruit', predicted_expiry: '2027-02-02' },
    { name: 'Spinach', food_group: 'veggies', predicted_expiry: '2027-01-01' },
  ] });
  return api;
}
async function show(api: MockApiClient) {
  return render(<ApiProvider client={api}><PreferencesProvider><HomeScreen /></PreferencesProvider></ApiProvider>);
}

beforeEach(async () => { jest.clearAllMocks(); await deviceStore.delete('home.dismissedTips.home-user'); });
afterEach(() => jest.restoreAllMocks());

test('shows soonest food, the top recipe, month impact, and accessible navigation', async () => {
  const api = await client();
  const impact = jest.spyOn(api, 'getImpact');
  const suggest = jest.spyOn(api, 'suggestRecipes');
  const { items } = await api.getItems() as ItemsResponse;
  const screen = await show(api);
  await screen.findByText('Use these first');
  expect(screen.getAllByLabelText(/^View /).map((row) => row.props.accessibilityLabel)).toEqual(['View Spinach', 'View Apples']);
  expect(impact).toHaveBeenCalledWith('month');
  expect(suggest).toHaveBeenCalledWith({ max_results: 1 });
  await fireEvent.press(screen.getByTestId(`home.item.${items[0].id}`));
  expect(router.push).toHaveBeenLastCalledWith(`/item/${items[0].id}`);
  await fireEvent.press(screen.getByTestId('home.recipe.card'));
  expect(router.push).toHaveBeenLastCalledWith('/recipes');
  await fireEvent.press(screen.getByLabelText('Settings'));
  expect(router.push).toHaveBeenLastCalledWith('/settings');
  await fireEvent.press(screen.getByTestId('home.impact.pill'));
  expect(router.push).toHaveBeenLastCalledWith('/impact');
});

test('first use shows Add food, a muted recipe placeholder and no tip', async () => {
  const screen = await show(await client(true));
  await screen.findByTestId('home.empty.state');
  expect(screen.queryByTestId('home.tip.card')).toBeNull();
  expect(screen.getByText("Recipes appear once you've added a few items")).toBeTruthy();
  expect(screen.getByText('0.0 lb saved')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home.empty.add'));
  expect(router.push).toHaveBeenCalledWith('/add-modal');
});

test('dismissal persists across remounts and preserves the verbatim tip', async () => {
  const api = await client();
  jest.spyOn(api, 'getTips').mockResolvedValue({ tips: [{ code: 'saved_recent', message: 'You used or donated 2 items in the last 30 days.' }] });
  const screen = await show(api);
  expect(await screen.findByText('You used or donated 2 items in the last 30 days.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home.tip.dismiss'));
  expect(screen.queryByTestId('home.tip.card')).toBeNull();
  await screen.unmount();
  const reopened = await show(api);
  await reopened.findByText('Use these first');
  expect(reopened.queryByTestId('home.tip.card')).toBeNull();
});

test('loading has a skeleton; errors retry against the mock client', async () => {
  const api = await client();
  let reject!: (reason: Error) => void;
  jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await show(api);
  expect(screen.getByTestId('home.loading.skeleton')).toBeTruthy();
  await act(() => reject(new Error('Offline')));
  expect(await screen.findByText('Offline')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home.error.retry'));
  expect(await screen.findByText('Spinach')).toBeTruthy();
});

test('a device storage failure keeps the tip visible and offers retry', async () => {
  const api = await client();
  const screen = await show(api);
  await screen.findByTestId('home.tip.card');
  jest.spyOn(deviceStore, 'set').mockRejectedValueOnce(new Error('Storage full'));
  await fireEvent.press(screen.getByTestId('home.tip.dismiss'));
  expect(await screen.findByTestId('home.tip.error')).toBeTruthy();
  expect(screen.getByTestId('home.tip.card')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home.tip.retry'));
  expect(screen.queryByTestId('home.tip.error')).toBeNull();
});
