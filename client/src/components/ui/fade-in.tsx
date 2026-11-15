import { type PropsWithChildren, useEffect } from 'react';
import { Animated, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { useTheme } from '@/theme';

interface FadeInProps extends PropsWithChildren, Pick<ViewProps, 'onPointerEnter' | 'onPointerLeave'> {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FadeIn({ children, delay = 0, style, testID, ...viewProps }: FadeInProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useAnimatedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    opacity.setValue(reducedMotion ? 1 : 0);
  }, [opacity, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const animation = Animated.timing(opacity, {
      delay,
      duration: theme.motion.quickMs,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, reducedMotion, theme.motion.quickMs]);

  return (
    <Animated.View {...viewProps} style={[style, { opacity: reducedMotion ? 1 : opacity }]} testID={testID}>
      {children}
    </Animated.View>
  );
}
