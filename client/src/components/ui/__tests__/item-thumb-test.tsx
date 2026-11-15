import { fireEvent, render } from '@testing-library/react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { motion, sizes } from '@/theme';

import { ItemThumb } from '../item-thumb';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
const hidden = { includeHiddenElements: true };

test('photo takes priority, then falls back to illustration and group icon on errors', async () => {
  const screen = await render(<ItemThumb name="Green apple" foodGroup="fruit" photoUrl="https://api.test/items/1/photo?sig=a" />);
  const photo = screen.getByTestId('itemThumb.photo', hidden);
  expect(photo.props.source).toEqual([expect.objectContaining({ uri: 'https://api.test/items/1/photo?sig=a', cacheKey: 'https://api.test/items/1/photo' })]);
  expect(photo.props.cachePolicy).toBe('memory-disk');
  expect(photo.props.recyclingKey).toBe('https://api.test/items/1/photo');
  expect(screen.queryByTestId('itemThumb.illustration', hidden)).toBeNull();
  await fireEvent(photo, 'error', { nativeEvent: { error: 'Expired signature' } });
  expect(screen.queryByTestId('itemThumb.photo', hidden)).toBeNull();
  await fireEvent(screen.getByTestId('itemThumb.illustration', hidden), 'error', { nativeEvent: { error: 'Asset failed' } });
  expect(screen.getByTestId('itemThumb.group', hidden)).toBeTruthy();
});

test('without a photo, uses a match or the group icon; the tile stays decorative', async () => {
  const screen = await render(<ItemThumb name="Rice" foodGroup="grains" size={sizes.emptyIcon} />);
  const illustration = screen.getByTestId('itemThumb.illustration', hidden);
  expect(illustration.props.accessible).toBe(false);
  expect(illustration.props.accessibilityLabel).toBe('');
  expect(illustration.parent?.props.importantForAccessibility).toBe('no-hide-descendants');
  await screen.rerender(<ItemThumb name="Unidentified food" foodGroup="other" />);
  expect(screen.getByTestId('itemThumb.group', hidden)).toBeTruthy();
});

test('changed signatures keep cache identity, retry a failed photo, and new foods recycle safely', async () => {
  const screen = await render(<ItemThumb name="Apple" foodGroup="fruit" photoUrl="https://api.test/items/1/photo?sig=a&v=2" />);
  const first = screen.getByTestId('itemThumb.photo', hidden);
  const key = first.props.recyclingKey;
  await fireEvent(first, 'error', { nativeEvent: { error: 'Expired' } });
  await screen.rerender(<ItemThumb name="Apple" foodGroup="fruit" photoUrl="https://api.test/items/1/photo?v=2&sig=b" />);
  expect(screen.getByTestId('itemThumb.photo', hidden).props.recyclingKey).toBe(key);
  await screen.rerender(<ItemThumb name="Milk" foodGroup="dairy" photoUrl="file:///picked.jpg" />);
  expect(screen.getByTestId('itemThumb.photo', hidden).props.recyclingKey).toBe('file:///picked.jpg');
  await screen.rerender(<ItemThumb name="Milk" foodGroup="dairy" photoUrl={null} />);
  expect(screen.getByTestId('itemThumb.illustration', hidden)).toBeTruthy();
});

test.each([true, false])('Reduce Motion=%s controls the photo transition', async (reduced) => {
  jest.mocked(useReducedMotion).mockReturnValue(reduced);
  const screen = await render(<ItemThumb name="Apple" foodGroup="fruit" photoUrl="file:///food.jpg" />);
  expect(screen.getByTestId('itemThumb.photo', hidden).props.transition).toEqual(expect.objectContaining({ duration: reduced ? 0 : motion.quickMs }));
});
