import { act, fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient, type Item, type Recipe } from '@/api';
import { RecipeDetailScreen } from '@/features/recipes/recipe-detail-screen';
import { getRecipe, rememberRecipes } from '@/features/recipes/recipe-store';
import { expiryPresentation } from '@/features/recipes/recipe-utils';
import { PreferencesProvider } from '@/settings/preferences';
import type { KeyValueStore } from '@/storage/key-value-store';

let mockKey = 'missing';
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockKey }),
  router: { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
const store: KeyValueStore = { get: async () => null, set: async () => {}, delete: async () => {} };

async function seed(missing: string[] = []) {
  const api = new MockApiClient();
  await api.signup({ email: 'cook@example.com', password: 'password-for-demo', display_name: 'Cook' });
  const { items } = await api.createItems({ items: [
    { name: 'Spinach', est_weight_kg: 0.2, predicted_expiry: '2026-11-10' },
    { name: 'Eggs', est_weight_kg: 0.4, predicted_expiry: '2026-11-09' },
  ] });
  const recipe: Recipe = {
    title: 'Spinach omelette', minutes: 20, servings: 2,
    uses_items: items.map((item) => ({ item_id: item.id, name: item.name, predicted_expiry: item.predicted_expiry })),
    missing_items: missing, steps: ['Whisk the eggs.', 'Cook with spinach.'],
    macros: { kcal: 410, protein_g: 27, carbs_g: 12, fat_g: 20 }, macros_estimated: true,
  };
  mockKey = rememberRecipes(api, [recipe])[0].key;
  return { api, recipe, items };
}
async function show(api: MockApiClient) {
  return render(<ApiProvider client={api}><PreferencesProvider store={store}><RecipeDetailScreen /></PreferencesProvider></ApiProvider>);
}
beforeEach(() => { jest.clearAllMocks(); jest.mocked(router.canGoBack).mockReturnValue(true); mockKey = 'missing'; });

test('renders ingredients, expiry badges, numbered steps, estimated macros and serving grams', async () => {
  const { api, items } = await seed();
  const screen = await show(api);
  expect(await screen.findByText('Serving size 300 g · 2 servings')).toBeTruthy();
  expect(screen.getByText('Ingredients')).toBeTruthy();
  expect(screen.getByText('Spinach')).toBeTruthy();
  expect(screen.getByTestId('recipeDetail.ingredient.' + items[0].id)).toHaveProp('accessibilityLabel', expect.stringContaining('In your fridge ·'));
  expect(screen.getByTestId('recipeDetail.step.0')).toHaveProp('accessibilityLabel', 'Step 1. Whisk the eggs.');
  expect(screen.getByTestId('recipeDetail.step.1')).toHaveProp('accessibilityLabel', 'Step 2. Cook with spinach.');
  expect(screen.getByText('20 min · macros estimated per serving')).toBeTruthy();
  expect(screen.queryByTestId('recipeDetail.missing.text')).toBeNull();
});

test('only recipes missing ingredients show You’ll need and do not guess a complete serving weight', async () => {
  const { api } = await seed(['Tomatoes']);
  const screen = await show(api);
  expect(await screen.findByText('Serving size unavailable · 2 servings')).toBeTruthy();
  expect(screen.getByText("You'll need: Tomatoes")).toBeTruthy();
  expect(screen.getByText('Tomatoes')).toBeTruthy();
});

test('I made this removes distinct fridge items sequentially once, then shows done and safely goes back', async () => {
  const { api, recipe, items } = await seed();
  mockKey = rememberRecipes(api, [{ ...recipe, uses_items: [...recipe.uses_items, recipe.uses_items[0]] }])[0].key;
  const actualRemove = api.removeItem.bind(api);
  let resolveFirst!: (value: { item: Item }) => void;
  const remove = jest.spyOn(api, 'removeItem').mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
  const screen = await show(api);
  await screen.findByTestId('recipeDetail.serving.text');
  await fireEvent.press(screen.getByTestId('recipeDetail.made.button'));
  await fireEvent.press(screen.getByTestId('recipeDetail.made.button'));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenNthCalledWith(1, items[0].id, { outcome: 'used' });
  await act(async () => resolveFirst(await actualRemove(items[0].id, { outcome: 'used' })));
  expect(await screen.findByText('Marked as made')).toBeTruthy();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenNthCalledWith(2, items[1].id, { outcome: 'used' });
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect((await api.getImpact()).used.count).toBe(2);
  await fireEvent.press(screen.getByTestId('recipeDetail.done.back'));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('partial failure is inline and retry never removes successful ingredients twice', async () => {
  const { api, items } = await seed();
  const actualRemove = api.removeItem.bind(api);
  const remove = jest.spyOn(api, 'removeItem').mockImplementationOnce(actualRemove)
    .mockRejectedValueOnce(new ApiError(503, 'upstream_unavailable', 'Server unavailable.'));
  const screen = await show(api);
  await screen.findByTestId('recipeDetail.serving.text');
  await fireEvent.press(screen.getByTestId('recipeDetail.made.button'));
  expect(await screen.findByText('Marked 1 of 2 items used. Eggs: Server unavailable. Try again to finish.')).toBeTruthy();
  expect(screen.getByText('Marked used')).toBeTruthy();
  expect(screen.queryByTestId('recipeDetail.done.state')).toBeNull();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
  await fireEvent.press(screen.getByTestId('recipeDetail.error.retry'));
  expect(await screen.findByText('Marked as made')).toBeTruthy();
  expect(remove).toHaveBeenCalledTimes(3);
  expect(remove).toHaveBeenNthCalledWith(3, items[1].id, { outcome: 'used' });
  expect((await api.getImpact()).used.count).toBe(2);
});

test('completed ingredient progress survives remount after a partial failure', async () => {
  const { api, items } = await seed();
  const actualRemove = api.removeItem.bind(api);
  const remove = jest.spyOn(api, 'removeItem').mockImplementationOnce(actualRemove).mockRejectedValueOnce(new Error('Try later.'));
  const first = await show(api);
  await first.findByTestId('recipeDetail.serving.text');
  await fireEvent.press(first.getByTestId('recipeDetail.made.button'));
  await first.findByTestId('recipeDetail.error.state');
  await first.unmount();
  const second = await show(api);
  await second.findByTestId('recipeDetail.serving.text');
  await fireEvent.press(second.getByTestId('recipeDetail.made.button'));
  expect(await second.findByText('Marked as made')).toBeTruthy();
  expect(remove).toHaveBeenNthCalledWith(3, items[1].id, { outcome: 'used' });
  expect(remove).toHaveBeenCalledTimes(3);
});

test('inventory has a loading skeleton and a working error retry', async () => {
  const { api } = await seed();
  let reject!: (error: Error) => void;
  jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await show(api);
  expect(screen.getByTestId('recipeDetail.loading.skeleton')).toBeTruthy();
  await act(() => reject(new Error('Connection lost.')));
  expect(await screen.findByTestId('recipeDetail.inventory.error')).toBeTruthy();
  expect(screen.getByText('Whisk the eggs.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipeDetail.inventory.retry'));
  expect(await screen.findByText('Serving size 300 g · 2 servings')).toBeTruthy();
});

test('cold-start missing keys return to Recipes; client stores are isolated and retain only the last result', async () => {
  const { api, recipe } = await seed();
  const oldKey = mockKey;
  const other = new MockApiClient();
  expect(getRecipe(other, oldKey)).toBeUndefined();
  rememberRecipes(api, [recipe]);
  expect(getRecipe(api, oldKey)).toBeUndefined();
  const screen = await show(api);
  expect(screen.getByText('Recipe no longer available')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipeDetail.empty.back'));
  expect(router.replace).toHaveBeenCalledWith('/recipes');
});

test('done uses a safe route when there is no back history', async () => {
  const { api } = await seed();
  jest.mocked(router.canGoBack).mockReturnValue(false);
  const screen = await show(api);
  await screen.findByTestId('recipeDetail.serving.text');
  await fireEvent.press(screen.getByTestId('recipeDetail.made.button'));
  await screen.findByTestId('recipeDetail.done.state');
  await fireEvent.press(screen.getByTestId('recipeDetail.done.back'));
  expect(router.replace).toHaveBeenCalledWith('/recipes');
});

test('unknown weights and null macros are displayed honestly', async () => {
  const { api, recipe, items } = await seed();
  await api.updateItem(items[0].id, { est_weight_kg: null });
  mockKey = rememberRecipes(api, [{ ...recipe, macros: null }])[0].key;
  const screen = await show(api);
  expect(await screen.findByText('Serving size unavailable · 2 servings')).toBeTruthy();
  expect(screen.queryByTestId('recipeDetail.macros.strip')).toBeNull();
});

test('expiry badges use the shared estimated range vocabulary and no fabricated date', () => {
  const today = new Date(2026, 10, 9);
  expect(expiryPresentation('2026-11-08', today)).toEqual({ label: 'Expired', urgent: true });
  expect(expiryPresentation('2026-11-09', today).label).toBe('Today');
  expect(expiryPresentation('2026-11-10', today).label).toBe('Tomorrow');
  expect(expiryPresentation('2026-11-12', today).label).toBe('2–3 days');
  expect(expiryPresentation('2026-11-23', today).label).toBe('1–2 weeks');
  expect(expiryPresentation(null, today).label).toBeNull();
});
