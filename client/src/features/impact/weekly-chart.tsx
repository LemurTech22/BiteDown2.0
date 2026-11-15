import { useEffect } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useAnimatedValue } from '@/hooks/use-animated-value';

import type { ImpactResponse } from '@/api';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

type Week = ImpactResponse['last_6_weeks'][number];

export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const maximum = Math.max(1, ...weeks.map((week) => week.saved + week.wasted));
  return (
    <View style={styles.card} testID="impact.weekly.chart">
      <Text accessibilityRole="header" style={styles.title}>Items per week</Text>
      <Text style={styles.meta}>Last 6 weeks, across all ranges</Text>
      <Text style={styles.meta}>Saved · Thrown out</Text>
      <View style={styles.chart}>
        {weeks.map((week, index) => <WeekBar key={week.week} week={week} index={index} maximum={maximum} />)}
      </View>
      {!weeks.length ? <Text style={styles.meta}>No weekly activity yet.</Text> : null}
    </View>
  );
}

function WeekBar({ week, index, maximum }: { week: Week; index: number; maximum: number }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const progress = useAnimatedValue(0);
  const total = week.saved + week.wasted;
  const height = theme.sizes.brandMark * 2;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: reducedMotion ? 0 : theme.motion.maxSequenceMs - theme.motion.chartBarMs -
        (theme.motion.maxStaggerItems - 1) * theme.motion.chartStaggerMs +
        Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.chartStaggerMs,
      duration: reducedMotion ? theme.motion.quickMs : theme.motion.chartBarMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, progress, reducedMotion, theme.motion.chartBarMs, theme.motion.chartStaggerMs,
    theme.motion.maxSequenceMs, theme.motion.maxStaggerItems, theme.motion.quickMs]);

  return (
    <View style={styles.column} accessible accessibilityLabel={`Week of ${week.week}: ${week.saved} saved, ${week.used} used, ${week.donated} donated, ${week.wasted} thrown out`}
      testID={`impact.week.${week.week}`}>
      <View style={[styles.barSpace, { height }]}>
        <Animated.View style={[styles.stack, { height: height * total / maximum },
          reducedMotion ? { opacity: progress } : { transform: [{ scaleY: progress }] }]}>
          <View style={[styles.wasted, { flex: week.wasted }]} />
          <View style={[styles.saved, { flex: week.saved }]} />
        </Animated.View>
      </View>
      <Animated.Text style={[styles.meta, { opacity: reducedMotion ? progress : progress.interpolate({ inputRange: [0, 0.99, 1], outputRange: [0, 0, 1] }) }]}>
        {week.saved}·{week.wasted}
      </Animated.Text>
      <Text style={styles.meta}>{week.week.slice(5).replace('-', '/')}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.lg, gap: theme.spacing.md },
    title: { ...theme.type.cardHeading, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted, textAlign: 'center' },
    chart: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-end' },
    column: { flex: 1, gap: theme.spacing.xs },
    barSpace: { justifyContent: 'flex-end' },
    stack: { transformOrigin: 'bottom', overflow: 'hidden', borderTopLeftRadius: theme.radii.chip, borderTopRightRadius: theme.radii.chip },
    saved: { backgroundColor: theme.colors.chartSaved },
    wasted: { backgroundColor: theme.colors.chartWasted },
  });
}
