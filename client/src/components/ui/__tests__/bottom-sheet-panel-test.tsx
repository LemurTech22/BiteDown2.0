import { render } from '@testing-library/react-native';

import { ApiProvider, MockApiClient } from '@/api';
import { MoveSheet } from '@/features/fridge/move-sheet';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { createTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

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
