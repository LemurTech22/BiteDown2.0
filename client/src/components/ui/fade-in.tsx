import { type PropsWithChildren, useEffect } from 'react';
import { Animated, type StyleProp, useAnimatedValue, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

interface FadeInProps extends PropsWithChildren {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FadeIn({ children, delay = 0, style, testID }: FadeInProps) {
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
    <Animated.View style={[style, { opacity }]} testID={testID}>
      {children}
    </Animated.View>
  );
}
