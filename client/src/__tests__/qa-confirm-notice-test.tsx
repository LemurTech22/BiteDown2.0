import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, Button, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { ApiProvider, MockApiClient } from '@/api';
import { NoticeProvider, useNotice } from '@/components/notice/notice';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { PreferencesProvider } from '@/settings/preferences';
import { createTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { router: { push: jest.fn() }, useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});

function ShowNotice() {
  const { show } = useNotice();
  return <Button title="Show notice" onPress={() => show('Saved changes to Apples')} />;
}

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([
  ['single', true], ['single', false], ['batch', true], ['batch', false],
] as const)('%s Undo remains usable below a polite notice; layout updates preserve its lifetime (Reduce Motion: %s)', async (kind, reducedMotion) => {
  jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
  const sequence = jest.spyOn(Animated, 'sequence');
  const api = new MockApiClient();
  await api.signup({ email: 'notice-qa@example.com', password: 'qa-password', display_name: 'QA' });
  const { items: [item] } = await api.createItems({ items: [{ name: 'Apples', storage: 'fridge' }] });
  const tabPress = jest.fn();
  const store = { get: async () => null, set: async () => {}, delete: async () => {} };
  function tree(fridge = true) {
    return <SafeAreaInsetsContext.Provider value={{ top: 44, bottom: 34, left: 0, right: 0 }}>
      <ApiProvider client={api}><PreferencesProvider store={store}><NoticeProvider>
        <ShowNotice /><Button title="Home tab" onPress={tabPress} />{fridge ? <FridgeScreen /> : null}
      </NoticeProvider></PreferencesProvider></ApiProvider>
    </SafeAreaInsetsContext.Provider>;
  }
  const screen = await render(tree());
  await screen.findByText('Apples');
  if (kind === 'single') {
    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
  } else {
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${item.id}`));
    await fireEvent.press(screen.getByTestId('fridge.batch.used'));
  }
  const theme = createTheme('light');
  const overlay = () => screen.getByTestId('fridge.undoOverlay');
  const measure = async (height: number) => fireEvent(overlay(), 'layout', { nativeEvent: { layout: { height } } });
  await measure(160);
  await fireEvent.press(screen.getByText('Show notice'));
  const container = () => screen.getByTestId('app.notice.container');
  const notice = screen.getByTestId('app.notice');
  expect(notice).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(container()).toHaveStyle({ pointerEvents: 'none', bottom: theme.sizes.tabBar + 160 + theme.spacing.sm, width: '100%', maxWidth: 520, alignSelf: 'center' });
  expect(StyleSheet.flatten(container().props.style).top).toBeUndefined();
  expect(container()).toHaveProp('edges', expect.objectContaining({ bottom: 'additive', top: 'off' }));
  const animations = sequence.mock.calls.length;
  await act(() => jest.advanceTimersByTime(1000));
  for (const height of [240, 240, 120]) {
    await measure(height);
    expect(container()).toHaveStyle({ bottom: theme.sizes.tabBar + height + theme.spacing.sm, pointerEvents: 'none' });
    expect(screen.getByTestId('app.notice')).toBe(notice);
  }
  expect(sequence).toHaveBeenCalledTimes(animations);
  await fireEvent.press(screen.getByText('Home tab'));
  expect(tabPress).toHaveBeenCalledTimes(1);
  const undo = kind === 'single' ? `remove.undo.${item.id}` : 'fridge.batchUndo.1';
  const dismiss = kind === 'single' ? `undo.dismiss.${item.id}` : 'fridge.batchUndo.dismiss.1';
  expect(screen.getByTestId(undo)).toBeEnabled();
  expect(screen.getByTestId(dismiss)).toBeEnabled();
  // Exercise each real overlay action while the notice is present.
  await fireEvent.press(screen.getByTestId(reducedMotion ? undo : dismiss));
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  expect(container()).toHaveStyle({ bottom: theme.sizes.tabBar });
  await screen.rerender(tree(false));
  await act(() => jest.advanceTimersByTime(1999));
  expect(screen.getByTestId('app.notice')).toBe(notice);
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId('app.notice')).toBeNull();
});
