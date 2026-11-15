import { render } from '@testing-library/react-native';
import { Animated, Text } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { createTheme } from '@/theme';

import { FadeIn } from '../fade-in';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));
afterEach(() => jest.restoreAllMocks());

test('normal motion uses the supplied delay and theme duration; enabling Reduce Motion stops it and shows full opacity', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue(animation);
  const screen = await render(<FadeIn delay={80} testID="fade"><Text>Food</Text></FadeIn>);
  expect(timing).toHaveBeenCalledWith(expect.any(Animated.Value), {
    delay: 80, duration: createTheme('light').motion.quickMs, toValue: 1, useNativeDriver: true,
  });
  expect(animation.start).toHaveBeenCalledTimes(1);
  jest.mocked(useReducedMotion).mockReturnValue(true);
  await screen.rerender(<FadeIn delay={80} testID="fade"><Text>Food</Text></FadeIn>);
  expect(animation.stop).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('fade')).toHaveStyle({ opacity: 1 });
});
