import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiProvider, MockApiClient, type ItemsResponse } from '@/api';
import { reportServerError } from '@/components/server-error';
import { HomeScreen } from '@/features/home/home-screen';
import { PreferencesProvider } from '@/settings/preferences';
import { deviceStore } from '@/storage/key-value-store';

const mockFocus: { current?: () => void | (() => void); cleanup?: void | (() => void) } = {};
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { router: { push: jest.fn() }, useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(() => {
    mockFocus.current = callback;
    mockFocus.cleanup = callback();
    return mockFocus.cleanup;
  }, [callback]) };
});
jest.mock('@/components/server-error', () => ({ reportServerError: jest.fn() }));
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

test('slow recipes leave food, tips and impact usable with a separate recipe skeleton', async () => {
  const api = await client();
  const response = await api.suggestRecipes({ max_results: 1 });
  let complete!: (value: typeof response) => void;
  jest.spyOn(api, 'suggestRecipes').mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const screen = await show(api);
  expect(await screen.findByText('Spinach')).toBeTruthy();
  expect(screen.getByTestId('home.tip.card')).toBeTruthy();
  expect(screen.getByTestId('home.impact.pill')).toBeTruthy();
  expect(screen.queryByTestId('home.loading.skeleton')).toBeNull();
  expect(screen.getByTestId('home.recipe.loading.skeleton')).toBeTruthy();
  await act(() => complete(response));
  expect(await screen.findByTestId('home.recipe.card')).toBeTruthy();
  expect(screen.queryByTestId('home.recipe.loading.skeleton')).toBeNull();
});

test('recipe failure hides only the recipe section and never reports a server error', async () => {
  const api = await client();
  let reject!: (cause: Error) => void;
  jest.spyOn(api, 'suggestRecipes').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await show(api);
  await screen.findByTestId('home.recipe.loading.skeleton');
  await act(() => reject(new Error('Recipe service unavailable')));
  expect(screen.getByText('Spinach')).toBeTruthy();
  expect(screen.getByTestId('home.impact.pill')).toBeTruthy();
  expect(screen.queryByText('Cook tonight')).toBeNull();
  expect(screen.queryByTestId('home.error.state')).toBeNull();
  expect(reportServerError).not.toHaveBeenCalled();
});

test.each(['resolve', 'reject'] as const)('ignores a stale recipe %s after refocusing', async (settlement) => {
  const api = await client();
  const response = await api.suggestRecipes({ max_results: 1 });
  let complete!: (value: typeof response) => void;
  let reject!: (cause: Error) => void;
  const suggest = jest.spyOn(api, 'suggestRecipes').mockImplementationOnce(() => new Promise((resolve, fail) => { complete = resolve; reject = fail; }));
  const screen = await show(api);
  await screen.findByTestId('home.recipe.loading.skeleton');
  await act(() => { mockFocus.cleanup?.(); mockFocus.cleanup = mockFocus.current?.(); });
  const card = await screen.findByTestId('home.recipe.card');
  const title = card.props.accessibilityLabel;
  await act(() => {
    if (settlement === 'resolve') complete({ ...response, recipes: [{ ...response.recipes[0], title: 'Stale recipe' }] });
    else reject(new Error('Stale failure'));
  });
  expect(screen.getByTestId('home.recipe.card').props.accessibilityLabel).toBe(title);
  expect(screen.queryByTestId('home.recipe.loading.skeleton')).toBeNull();
  expect(suggest).toHaveBeenCalledTimes(2);
  expect(reportServerError).not.toHaveBeenCalled();
});

test('refocusing reuses a shown recipe until the set of item ids changes', async () => {
  const api = await client();
  const suggest = jest.spyOn(api, 'suggestRecipes');
  const screen = await show(api);
  await screen.findByTestId('home.recipe.card');
  await act(() => { mockFocus.cleanup?.(); mockFocus.cleanup = mockFocus.current?.(); });
  await screen.findByTestId('home.recipe.card');
  expect(suggest).toHaveBeenCalledTimes(1);
  await api.createItems({ items: [{ name: 'Carrots', food_group: 'veggies' }] });
  await act(() => { mockFocus.cleanup?.(); mockFocus.cleanup = mockFocus.current?.(); });
  await screen.findByText('Carrots');
  await screen.findByTestId('home.recipe.card');
  expect(suggest).toHaveBeenCalledTimes(2);
});
