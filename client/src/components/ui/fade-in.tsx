import { type PropsWithChildren, useEffect } from 'react';
import { Animated, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useAnimatedValue } from '@/hooks/use-animated-value';

import { useTheme } from '@/theme';

interface FadeInProps extends PropsWithChildren, Pick<ViewProps, 'onPointerEnter' | 'onPointerLeave'> {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FadeIn({ children, delay = 0, style, testID, ...viewProps }: FadeInProps) {
  const theme = useTheme();
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      delay,
      duration: theme.motion.quickMs,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, theme.motion.quickMs]);

  return (
    <Animated.View {...viewProps} style={[style, { opacity }]} testID={testID}>
      {children}
    </Animated.View>
  );
}
