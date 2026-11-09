import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient, type Recipe } from '@/api';
import { RecipesScreen } from '@/features/recipes/recipes-screen';
import { getRecipe } from '@/features/recipes/recipe-store';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { router: { push: jest.fn() }, useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});

const base: Recipe = {
  title: 'Spinach omelette', minutes: 20, servings: 2,
  uses_items: [{ item_id: 'spinach', name: 'Spinach', predicted_expiry: '2026-11-09' }],
  missing_items: [], steps: ['Cook and serve.'],
  macros: { kcal: 410, protein_g: 27, carbs_g: 12, fat_g: 20 }, macros_estimated: true,
};

async function client(recipes: Recipe[] = [base]) {
  const api = new MockApiClient();
  await api.signup({ email: 'recipes@example.com', password: 'password-for-demo', display_name: 'Cook' });
  jest.spyOn(api, 'suggestRecipes').mockResolvedValue({ recipes });
  return api;
}
async function show(api: MockApiClient) { return render(<ApiProvider client={api}><RecipesScreen /></ApiProvider>); }

beforeEach(() => jest.clearAllMocks());

test('requests ten suggestions, filters missing ingredients by default, shows macros and stores the route payload', async () => {
  const api = await client([base, { ...base, title: 'Needs tomatoes', missing_items: ['Tomatoes'] }, { ...base, title: 'Rice bowl' }]);
  const screen = await show(api);
  expect(await screen.findByText('Spinach omelette')).toBeTruthy();
  expect(api.suggestRecipes).toHaveBeenCalledWith({ max_results: 10 });
  expect(screen.getByTestId('recipes.filter.onlyHave')).toHaveProp('accessibilityState', { selected: true });
  expect(screen.queryByText('Needs tomatoes')).toBeNull();
  expect(screen.getByText('Rice bowl')).toBeTruthy();
  expect(screen.getByText('410')).toBeTruthy();
  expect(screen.getByText('27 g')).toBeTruthy();
  expect(screen.getByText('20 min · 2 servings')).toBeTruthy();
  const best = screen.getAllByRole('button').find((button) => String(button.props.testID).startsWith('recipes.card.'))!;
  await fireEvent.press(best);
  const route = jest.mocked(router.push).mock.calls[0][0] as unknown as { params: { id: string } };
  expect(getRecipe(api, route.params.id)).toEqual(base);
  expect(router.push).toHaveBeenCalledWith({ pathname: '/recipes/[id]', params: { id: route.params.id } });
});

test('the filtered empty state turns Only what I have off without another request', async () => {
  const api = await client([{ ...base, missing_items: ['Tomatoes'] }]);
  const screen = await show(api);
  expect(await screen.findByText('Nothing from just what you have')).toBeTruthy();
  await fireEvent.press(screen.getByText('Show recipes that need a few things'));
  expect(screen.getByText('Spinach omelette')).toBeTruthy();
  expect(screen.getByTestId('recipes.filter.onlyHave')).toHaveProp('accessibilityState', { selected: false });
  expect(api.suggestRecipes).toHaveBeenCalledTimes(1);
});

test('sorts by earliest expiry and the quick filter excludes thirty minutes', async () => {
  const late = { ...base, title: 'Slow stew', minutes: 40, uses_items: [{ item_id: 'late', name: 'Rice', predicted_expiry: '2026-11-20' }] };
  const api = await client([late, { ...base, title: 'Thirty minutes', minutes: 30 }, base]);
  const screen = await show(api);
  await screen.findByText('Slow stew');
  let cards = screen.getAllByRole('button').filter((button) => String(button.props.testID).startsWith('recipes.card.'));
  expect(cards[0]).toHaveProp('accessibilityLabel', expect.stringContaining('Thirty minutes'));
  await fireEvent.press(screen.getByTestId('recipes.filter.expiring'));
  cards = screen.getAllByRole('button').filter((button) => String(button.props.testID).startsWith('recipes.card.'));
  expect(cards[0]).toHaveProp('accessibilityLabel', expect.stringContaining('Slow stew'));
  await fireEvent.press(screen.getByTestId('recipes.filter.quick'));
  expect(screen.queryByText('Slow stew')).toBeNull();
  expect(screen.queryByText('Thirty minutes')).toBeNull();
  expect(screen.getByText('Spinach omelette')).toBeTruthy();
});

test('vegetarian is requested from the API and ignores a stale nonvegetarian response', async () => {
  const api = await client();
  let resolveOld!: (response: { recipes: Recipe[] }) => void;
  jest.mocked(api.suggestRecipes).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ recipes: [{ ...base, title: 'Vegetarian meal' }] });
  const screen = await show(api);
  expect(screen.getByTestId('recipes.loading.skeleton')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipes.filter.vegetarian'));
  expect(await screen.findByText('Vegetarian meal')).toBeTruthy();
  expect(api.suggestRecipes).toHaveBeenLastCalledWith({ max_results: 10, dietary: ['vegetarian'] });
  await act(() => resolveOld({ recipes: [{ ...base, title: 'Old result' }] }));
  expect(screen.queryByText('Old result')).toBeNull();
});

test('shows a loading skeleton, handles errors and retries', async () => {
  const api = await client();
  let reject!: (error: ApiError) => void;
  jest.mocked(api.suggestRecipes).mockImplementationOnce(() => new Promise((_, failure) => { reject = failure; }));
  const screen = await show(api);
  expect(screen.getByTestId('recipes.loading.skeleton')).toBeTruthy();
  await act(() => reject(new ApiError(502, 'upstream_unavailable', 'Recipe helper unavailable.')));
  expect(await screen.findByText('Recipe helper unavailable.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipes.error.retry'));
  expect(await screen.findByText('Spinach omelette')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipes.refresh.button'));
  await waitFor(() => expect(api.suggestRecipes).toHaveBeenCalledTimes(3));
});

test('an empty fridge shows the empty state and a working retry', async () => {
  const api = await client([]);
  const screen = await show(api);
  expect(await screen.findByText('No recipes yet')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipes.empty.retry'));
  await waitFor(() => expect(api.suggestRecipes).toHaveBeenCalledTimes(2));
});

test('quick-filter empty state can clear filters', async () => {
  const api = await client([{ ...base, minutes: 30 }]);
  const screen = await show(api);
  await screen.findByText('Spinach omelette');
  await fireEvent.press(screen.getByTestId('recipes.filter.quick'));
  expect(screen.getByText('No recipes match')).toBeTruthy();
  await fireEvent.press(screen.getByText('Clear filters'));
  expect(screen.getByText('Spinach omelette')).toBeTruthy();
});
