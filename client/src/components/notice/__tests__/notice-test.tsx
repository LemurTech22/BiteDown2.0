import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated, Button, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { NoticeProvider, useNotice } from '@/components/notice/notice';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { createTheme, useTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useTheme: jest.fn() }));

function Controls() {
  const { show } = useNotice();
  return <>
    <Button title="First" onPress={() => show('Saved changes to Spinach')} />
    <Button title="Second" onPress={() => show('Saved changes to Apples')} />
  </>;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(useReducedMotion).mockReturnValue(true);
  jest.mocked(useTheme).mockReturnValue(createTheme('light'));
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([true, false])('announces politely, allows touches through, stays in the safe column, and hides at 3 seconds (Reduce Motion: %s)', async (reducedMotion) => {
  jest.mocked(useReducedMotion).mockReturnValue(reducedMotion);
  const screen = await render(<SafeAreaInsetsContext.Provider value={{ top: 44, left: 0, right: 0, bottom: 34 }}>
    <NoticeProvider><Controls /></NoticeProvider>
  </SafeAreaInsetsContext.Provider>);
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByText('First'));
  expect(screen.getByTestId('app.notice')).toHaveTextContent('Saved changes to Spinach');
  expect(screen.getByTestId('app.notice')).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(screen.getByTestId('app.notice')).toHaveProp('numberOfLines', 1);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('app.notice.container')).toHaveStyle({ pointerEvents: 'none' });
  expect(screen.getByTestId('app.notice.container')).toHaveProp('edges', expect.objectContaining({ top: 'additive' }));
  expect(screen.getByTestId('app.notice.container')).toHaveStyle({ width: '100%', maxWidth: 520, alignSelf: 'center', top: 0 });
  await act(() => jest.advanceTimersByTime(2999));
  expect(screen.getByTestId('app.notice')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('replacement resets the timeout, including when the same text is shown again', async () => {
  const screen = await render(<NoticeProvider><Controls /></NoticeProvider>);
  await fireEvent.press(screen.getByText('First'));
  await act(() => jest.advanceTimersByTime(2000));
  await fireEvent.press(screen.getByText('Second'));
  expect(screen.getAllByTestId('app.notice')).toHaveLength(1);
  expect(screen.getByTestId('app.notice')).toHaveTextContent('Saved changes to Apples');
  await act(() => jest.advanceTimersByTime(2000));
  await fireEvent.press(screen.getByText('Second'));
  await act(() => jest.advanceTimersByTime(2999));
  expect(screen.getByTestId('app.notice')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(1));
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('notice survives the originating screen unmounting', async () => {
  const screen = await render(<NoticeProvider><Controls /></NoticeProvider>);
  await fireEvent.press(screen.getByText('First'));
  await screen.rerender(<NoticeProvider><Text>Fridge</Text></NoticeProvider>);
  expect(screen.getByText('Fridge')).toBeTruthy();
  expect(screen.getByTestId('app.notice')).toHaveTextContent('Saved changes to Spinach');
});

test('fades with theme timing and stops the old animation on replacement and unmount', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const timing = jest.spyOn(Animated, 'timing');
  const timeout = jest.spyOn(globalThis, 'setTimeout');
  const clear = jest.spyOn(globalThis, 'clearTimeout');
  const stop = jest.fn();
  const sequence = jest.spyOn(Animated, 'sequence').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const screen = await render(<NoticeProvider><Controls /></NoticeProvider>);
  await fireEvent.press(screen.getByText('First'));
  expect(timing).toHaveBeenNthCalledWith(1, expect.any(Animated.Value), { toValue: 1, duration: createTheme('light').motion.quickMs, useNativeDriver: true });
  expect(timing).toHaveBeenNthCalledWith(2, expect.any(Animated.Value), { toValue: 0, duration: createTheme('light').motion.quickMs, useNativeDriver: true });
  await fireEvent.press(screen.getByText('Second'));
  const deadlines = timeout.mock.calls.flatMap(([, delay], index) => delay === 3000 ? [timeout.mock.results[index].value] : []);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(sequence).toHaveBeenCalledTimes(2);
  await screen.unmount();
  expect(stop).toHaveBeenCalledTimes(2);
  expect(deadlines).toHaveLength(2);
  for (const deadline of deadlines) expect(clear).toHaveBeenCalledWith(deadline);
});

test('Reduce Motion appears and disappears without fading and preserves the deadline when toggled', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const screen = await render(<NoticeProvider><Controls /></NoticeProvider>);
  await fireEvent.press(screen.getByText('First'));
  expect(timing).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(2000));
  jest.mocked(useReducedMotion).mockReturnValue(false);
  await screen.rerender(<NoticeProvider><Controls /></NoticeProvider>);
  jest.mocked(useReducedMotion).mockReturnValue(true);
  await screen.rerender(<NoticeProvider><Controls /></NoticeProvider>);
  timing.mockClear();
  await act(() => jest.advanceTimersByTime(1000));
  expect(screen.queryByTestId('app.notice')).toBeNull();
  expect(timing).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)('%s notice colors meet AA text contrast', async (scheme) => {
  const theme = createTheme(scheme);
  jest.mocked(useTheme).mockReturnValue(theme);
  const screen = await render(<NoticeProvider><Controls /></NoticeProvider>);
  await fireEvent.press(screen.getByText('First'));
  expect(screen.getByTestId('app.notice')).toHaveStyle({ color: theme.colors.onForest });
  expect(screen.getByTestId('app.notice').parent).toHaveStyle({ backgroundColor: theme.colors.forest });
  function luminance(hex: string) {
    const channels = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const values = [luminance(theme.colors.onForest), luminance(theme.colors.forest)];
  expect((Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
