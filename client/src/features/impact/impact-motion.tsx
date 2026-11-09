import { useEffect, useState } from 'react';
import { Animated, type StyleProp, type TextStyle, useAnimatedValue } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme';

export function SavedCounter({ value, format, style }: {
  value: number;
  format: (value: number) => string;
  style: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useAnimatedValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const listener = progress.addListener(({ value: next }) => setDisplay(next));
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: value,
      duration: theme.motion.maxSequenceMs, useNativeDriver: false });
    animation.start();
    return () => { animation.stop(); progress.removeListener(listener); };
  }, [progress, reducedMotion, theme.motion.maxSequenceMs, value]);

  return <Animated.Text accessibilityLabel={`Food saved, ${format(value)}`} style={style}
    testID="impact.saved.value">{format(reducedMotion ? value : display)}</Animated.Text>;
}
