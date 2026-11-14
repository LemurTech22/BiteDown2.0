import { fireEvent, render } from '@testing-library/react-native';

import { ItemThumb, photoCacheKey } from '@/components/ui/item-thumb';
import { FOOD_ILLUSTRATIONS, matchFoodIllustration } from '@/features/food-art/food-illustrations';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { createTheme, useTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useTheme: jest.fn() }));
// Node is available to Jest; the app intentionally excludes Node globals from its TS types.
declare const __dirname: string;
const { readFileSync, readdirSync } = jest.requireActual<{
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string) => string[];
}>('node:fs');
const { resolve } = jest.requireActual<{ resolve: (...paths: string[]) => string }>('node:path');
const hidden = { includeHiddenElements: true };
const path = 'https://api.test/items/apple/photo';

beforeEach(() => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  jest.mocked(useTheme).mockReturnValue(createTheme('light'));
});
afterEach(() => jest.restoreAllMocks());

test.each(['?sig=old', '?v=1&sig=new#fragment', '#fragment', ''])('cache identity strips query/fragment %s without constructing URL', (suffix) => {
  const constructor = jest.spyOn(globalThis, 'URL').mockImplementation(() => { throw new Error('Native URL API unavailable'); });
  expect(photoCacheKey(path + suffix)).toBe(path);
  expect(constructor).not.toHaveBeenCalled();
});

test.each(['Expired signature', '404 not_found'])('photo error %s falls through both levels, fresh signature retries', async (error) => {
  const screen = await render(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=old`} />);
  expect(screen.queryByTestId('itemThumb.illustration', hidden)).toBeNull();
  await fireEvent(screen.getByTestId('itemThumb.photo', hidden), 'error', { nativeEvent: { error } });
  await fireEvent(screen.getByTestId('itemThumb.illustration', hidden), 'error', { nativeEvent: { error: 'Missing SVG' } });
  expect(screen.getByTestId('itemThumb.group', hidden)).toBeTruthy();
  await screen.rerender(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=new`} />);
  expect(screen.getByTestId('itemThumb.photo', hidden).props.source).toEqual([expect.objectContaining({ uri: `${path}?sig=new`, cacheKey: path })]);
  expect(screen.queryByTestId('itemThumb.group', hidden)).toBeNull();
});

test('successful signature renewal preserves the mounted image and recycling identity', async () => {
  const screen = await render(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=old`} />);
  const first = screen.getByTestId('itemThumb.photo', hidden);
  await fireEvent(first, 'load', { nativeEvent: { source: { url: `${path}?sig=old` } } });
  await screen.rerender(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=new`} />);
  const next = screen.getByTestId('itemThumb.photo', hidden);
  expect(next).toBe(first);
  expect(next.props.recyclingKey).toBe(path);
  expect(screen.queryByTestId('itemThumb.illustration', hidden)).toBeNull();
});

test('CL-15: a loaded photo does not request another fade when only its signature changes', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const screen = await render(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=old`} />);
  await fireEvent(screen.getByTestId('itemThumb.photo', hidden), 'load', { nativeEvent: { source: { url: `${path}?sig=old` } } });
  await screen.rerender(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=new`} />);
  // SDK 58 applies a positive transition on subsequent source changes, including cache hits.
  expect(screen.getByTestId('itemThumb.photo', hidden).props.transition?.duration ?? 0).toBe(0);
});

test.each(['light', 'dark'] as const)('%s theme supplies tile tokens, thumbnails stay decorative and Reduce Motion disables fade', async (scheme) => {
  const theme = createTheme(scheme);
  jest.mocked(useTheme).mockReturnValue(theme);
  const screen = await render(<ItemThumb name="Apples" foodGroup="fruit" photoUrl={`${path}?sig=a`} />);
  const image = screen.getByTestId('itemThumb.photo', hidden);
  expect(image.props.transition.duration).toBe(0);
  expect(image.props.accessible).toBe(false);
  expect(image.props.accessibilityLabel).toBe('');
  expect(image.parent?.props).toMatchObject({ accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
  expect(image.parent?.props.style).toMatchObject({ backgroundColor: theme.foodGroups.fruit.tile, borderRadius: theme.radii.input, width: theme.sizes.itemIcon });
  await screen.rerender(<ItemThumb name="Spear" foodGroup="other" />);
  expect(screen.getByTestId('itemThumb.group', hidden).parent?.props.importantForAccessibility).toBe('no-hide-descendants');
});

test.each([
  ['spear', null], ['spearhead', null], ['hamster', null], ['hamburger', 'hamburger'],
  ['eggplant', 'eggplant'], ['eggplants', 'eggplant'], ['Apples', 'red_apple'], ['EGGS!', 'egg'],
  ['2 lb chicken breast', 'poultry_leg'], ['green-APPLES (organic)', 'green_apple'],
  ['canned beans', 'canned_food'], ['sweet potatoes', 'roasted_sweet_potato'],
  ['chilli-peppers', 'hot_pepper'], ['curry rice', 'curry_rice'], ['ice cream', 'ice_cream'],
  ['capsicums', 'bell_pepper'], ['courgettes', 'cucumber'], ['prawns', 'shrimp'], ['scallions', 'onion'],
  ['yams', 'roasted_sweet_potato'], ['mozzarella', 'cheese_wedge'], ['mandarins', 'tangerine'],
  ['arugula', 'leafy_green'], ['noodles', 'spaghetti'], ['leftovers', 'takeout_box'],
  ['mystery food', null], ['', null],
] as const)('matcher: %s -> %s', (name, expected) => expect(matchFoodIllustration(name)).toBe(expected));

test('asset inventory: 87 real SVGs, no unreported files, retained Microsoft MIT licence', () => {
  const assetDir = resolve(__dirname, '../../assets/food');
  const manifest = readFileSync(resolve(__dirname, '../features/food-art/food-illustrations.ts'), 'utf8');
  const referenced = [...manifest.matchAll(/assets\/food\/([^']+\.svg)/g)].map((match) => match[1]);
  expect(referenced).toHaveLength(87);
  expect(new Set(referenced).size).toBe(87);
  expect(Object.keys(FOOD_ILLUSTRATIONS)).toHaveLength(87);
  expect(readdirSync(assetDir).sort()).toEqual([...referenced, 'LICENSE-fluentui-emoji.txt'].sort());
  for (const asset of referenced) expect(readFileSync(resolve(assetDir, asset), 'utf8')).toMatch(/<svg\b/);
  expect(readFileSync(resolve(assetDir, 'LICENSE-fluentui-emoji.txt'), 'utf8')).toMatch(/MIT License[\s\S]+Microsoft Corporation/);
});
