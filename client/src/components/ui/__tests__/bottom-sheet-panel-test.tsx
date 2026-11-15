import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ApiProvider, MockApiClient } from '@/api';
import { MoveSheet } from '@/features/fridge/move-sheet';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { createTheme, useTheme } from '@/theme';

import { DateSheet } from '../date-sheet';
import { EditSheet } from '../edit-sheet';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useTheme: jest.fn() }));
beforeEach(() => jest.mocked(useTheme).mockReturnValue(createTheme('light')));

test.each(['remove', 'move'] as const)('%s sheet panel stays full width up to the centred content cap', async (sheet) => {
  const api = new MockApiClient();
  await api.signup({ email: 'sheet@example.com', password: 'password-for-demo', display_name: 'Demo' });
  const { items: [item] } = await api.createItems({ items: [
    { name: 'Spinach', food_group: 'veggies', storage: 'fridge', freshness: 'semi_fresh' },
  ] });
  const screen = await render(<ApiProvider client={api}>
    {sheet === 'remove'
      ? <RemoveSheet item={item} onClose={jest.fn()} onRemoved={jest.fn()} />
      : <MoveSheet item={item} onClose={jest.fn()} onMoved={jest.fn()} />}
  </ApiProvider>);

  expect(screen.getByTestId(sheet === 'remove' ? 'remove.sheet.panel' : 'fridge.move.panel')).toHaveStyle({
    width: '100%',
    maxWidth: createTheme('light').sizes.webMaxContentWidth,
    alignSelf: 'center',
  });
});

test.each(['light', 'dark'] as const)('%s edit and date sheets have a visible, padded surface within the column cap', async (scheme) => {
  const theme = createTheme(scheme);
  jest.mocked(useTheme).mockReturnValue(theme);
  const screen = await render(<>
    <EditSheet title="Stored in" testID="edit.sheet" onClose={jest.fn()}><Text>Fridge</Text></EditSheet>
    <DateSheet value="2026-11-14" now={new Date(2026, 10, 14)} onSelect={jest.fn()} onClose={jest.fn()} />
  </>);
  for (const id of ['edit.sheet.panel', 'date.sheet.panel']) {
    expect(screen.getByTestId(id)).toHaveStyle({
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radii.sheet,
      borderTopRightRadius: theme.radii.sheet,
      padding: theme.spacing.gutter,
      width: '100%', maxWidth: theme.sizes.webMaxContentWidth, alignSelf: 'center',
    });
  }
  expect(screen.getByText('Stored in')).toHaveStyle({ color: theme.colors.ink });
  expect(screen.getByText('Use by')).toHaveStyle({ color: theme.colors.ink });
  expect(screen.getByText('Sun')).toHaveStyle({ color: theme.colors.muted });
  expect(screen.getByTestId('date.day.2026-11-13').children[0]).toHaveStyle({ color: theme.colors.ink });
  expect(screen.getByTestId('date.day.2026-11-14')).toHaveStyle({ backgroundColor: theme.colors.forest });
  expect(screen.getByText('14 ✓')).toHaveStyle({ color: theme.colors.onForest });

  function luminance(hex: string) {
    const [r, g, b] = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  for (const [foreground, background] of [
    [theme.colors.ink, theme.colors.surface], [theme.colors.muted, theme.colors.surface],
    [theme.colors.forest, theme.colors.surface], [theme.colors.onForest, theme.colors.forest],
  ]) {
    const values = [luminance(foreground), luminance(background)];
    expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
