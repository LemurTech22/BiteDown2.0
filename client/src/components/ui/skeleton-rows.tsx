import { useEffect } from 'react';
import { Animated, StyleSheet, useAnimatedValue, View } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

export function SkeletonRows({ testID }: { testID: string }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useAnimatedValue(0.55);
  const styles = createStyles(theme);

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(0.55);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: theme.motion.shimmerMs / 2,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: theme.motion.shimmerMs / 2,
          toValue: 0.55,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion, theme.motion.shimmerMs]);

  return (
    <View accessibilityLabel="Loading" testID={testID}>
      {Array.from({ length: 4 }, (_, index) => (
        <Animated.View key={index} style={[styles.row, { opacity }]}>
          <View style={styles.icon} />
          <View style={styles.lines}>
            <View style={styles.titleLine} />
            <View style={styles.metaLine} />
          </View>
          <View style={styles.badge} />
        </Animated.View>
      ))}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.row,
      flexDirection: 'row',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      minHeight: theme.sizes.skeletonRow,
      padding: theme.spacing.md,
    },
    icon: {
      backgroundColor: theme.colors.track,
      borderRadius: theme.radii.input,
      height: theme.sizes.itemIcon,
      width: theme.sizes.itemIcon,
    },
    lines: { flex: 1, gap: theme.spacing.sm },
    titleLine: {
      backgroundColor: theme.colors.track,
      borderRadius: theme.radii.chip,
      height: theme.spacing.md,
      width: '70%',
    },
    metaLine: {
      backgroundColor: theme.colors.track,
      borderRadius: theme.radii.chip,
      height: theme.spacing.sm,
      width: '45%',
    },
    badge: {
      backgroundColor: theme.colors.track,
      borderRadius: theme.radii.chip,
      height: theme.spacing.xl,
      width: theme.sizes.skeletonBadge,
    },
  });
}
