import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * Stable Animated.Value for the component's lifetime. React Native's own `useAnimatedValue` is missing from
 * react-native-web, so the web build crashed on import; this works on every platform.
 */
export function useAnimatedValue(initialValue: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}
