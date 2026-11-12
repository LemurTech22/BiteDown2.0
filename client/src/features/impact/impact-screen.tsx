import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type ImpactRange, type ImpactResponse, type ImpactTotals, useApi, type WasteReason } from '@/api';
import { reportServerError } from '@/components/server-error';
import { FadeIn } from '@/components/ui/fade-in';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { type AppTheme, useTheme } from '@/theme';

import { change, money, percent, weight } from './format';
import { SavedCounter } from './impact-motion';
import { WeeklyChart } from './weekly-chart';

const ranges = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'all', label: 'All' }] as const;
const reasons: Record<WasteReason, string> = { expired: 'Expired', forgot: 'Forgot about it', didnt_like: 'Didn’t like it', other: 'Other' };

export function ImpactScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [range, setRange] = useState<ImpactRange>('month');
  const [attempt, setAttempt] = useState(0);
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>Your impact</Text>
        <View style={styles.segments} accessibilityLabel="Impact range">
          {ranges.map((option) => <Pressable key={option.value} accessibilityRole="radio"
            accessibilityLabel={`Impact range: ${option.label}`} accessibilityState={{ checked: range === option.value }}
            onPress={() => setRange(option.value)} testID={`impact.range.${option.value}`}
            style={[styles.segment, range === option.value && styles.selected]}>
            <Text style={[styles.segmentText, range === option.value && styles.selectedText]}>{option.label}</Text>
          </Pressable>)}
        </View>
        <ImpactRangeContent key={`${range}:${attempt}`} range={range} onRetry={() => setAttempt((value) => value + 1)} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ImpactRangeContent({ range, onRetry }: { range: ImpactRange; onRetry: () => void }) {
  const { api } = useApi();
  const [result, setResult] = useState<ImpactResponse | null>(null);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    void api.getImpact(range).then((response) => {
      if (active) { setError(''); setResult(response); }
    })
      .catch((cause: unknown) => { reportServerError(cause); if (active) setError(cause instanceof Error ? cause.message : 'We couldn’t load your impact. Try again.'); });
    return () => { active = false; };
  }, [api, range]));

  if (error) return <StateView icon="alert-circle-outline" title="Couldn’t load impact" message={error}
    testID="impact.error.state" actionLabel="Try again" actionTestID="impact.retry.button"
    onAction={onRetry} />;
  if (!result) return <SkeletonRows testID="impact.loading.skeleton" />;
  return <ImpactTotalsView result={result} />;
}

function ImpactTotalsView({ result }: { result: ImpactResponse }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { previous } = result;
  const empty = result.saved.count + result.wasted.count === 0;
  const previousLabel = result.range === 'week' ? 'previous 7 days' : 'previous 30 days';
  return (
    <View style={styles.sections}>
      {empty ? <StateView icon="leaf" title="Your impact starts here" message="Use or donate food to start saving. Your activity for this range will appear here."
        testID="impact.empty.state" /> : null}
      <FadeIn style={styles.hero} testID="impact.hero.card">
        <Text style={styles.heroLabel}>Food saved</Text>
        <SavedCounter value={result.saved.kg} format={weight} style={styles.heroNumber} />
        {previous ? <Text style={styles.heroMeta} testID="impact.saved.change">{change(result.saved.kg, previous.saved.kg, weight, previousLabel)}</Text> : null}
        <Text style={styles.heroMeta} testID="impact.carbon.value">{weight(result.saved.co2e_kg)} of carbon emissions avoided</Text>
      </FadeIn>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Items saved</Text>
        <Text style={styles.number} testID="impact.items.value">{result.saved.count}</Text>
        <Text style={styles.meta}>{result.used.count} used · {result.donated.count} donated</Text>
        {previous ? <Text style={styles.meta}>{change(result.saved.count, previous.saved.count, (value) => `${value} items`)}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Money saved</Text>
        <Text style={styles.number} testID="impact.money.value">{money(result.saved.money)}</Text>
        {previous ? <Text style={styles.meta}>{change(result.saved.money, previous.saved.money, money)}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Waste rate</Text>
        <Text style={styles.number} testID="impact.wasteRate.value">{percent(result.waste_rate)}</Text>
        <Text style={styles.meta}>{weight(result.wasted.kg)} of {weight(result.saved.kg + result.wasted.kg)} thrown out</Text>
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Waste rate"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(result.waste_rate * 100), text: percent(result.waste_rate) }}
          style={styles.track} testID="impact.wasteRate.meter">
          <View style={[styles.meter, { width: `${Math.min(1, Math.max(0, result.waste_rate)) * 100}%` }]} />
        </View>
        {previous ? <Text style={styles.meta}>{change(result.waste_rate * 100, previous.waste_rate * 100, (value) => `${value.toFixed(1)} percentage points`)}</Text> : null}
      </View>
      {(['used', 'donated', 'wasted'] as const).map((kind) => <OutcomeTotals key={kind} kind={kind}
        total={result[kind]} previous={previous?.[kind]} />)}
      <WeeklyChart weeks={result.last_6_weeks} />
      <View style={styles.card} testID="impact.reasons.card">
        <Text accessibilityRole="header" style={styles.cardTitle}>Why food got thrown out</Text>
        {result.waste_reasons.map((reason) => <View key={reason.reason} style={styles.reason}>
          <Text style={styles.meta}>{reasons[reason.reason]} · {reason.count} {reason.count === 1 ? 'item' : 'items'} · {percent(reason.share)}</Text>
          <View style={styles.track}><View style={[styles.meter, { width: `${Math.min(1, Math.max(0, reason.share)) * 100}%` }]} /></View>
        </View>)}
        {!result.wasted.count ? <Text style={styles.meta}>No food thrown out in this range.</Text> : null}
      </View>
    </View>
  );
}

function OutcomeTotals({ kind, total, previous }: { kind: 'used' | 'donated' | 'wasted'; total: ImpactTotals; previous?: ImpactTotals }) {
  const styles = createStyles(useTheme());
  const label = kind === 'used' ? 'Used' : kind === 'donated' ? 'Donated' : 'Thrown out';
  return (
    <View style={styles.card} testID={`impact.${kind}.card`}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Text style={styles.meta} testID={`impact.${kind}.value`}>{total.count} {total.count === 1 ? 'item' : 'items'} · {weight(total.kg)}</Text>
      <Text style={styles.meta}>{money(total.money)} {kind === 'wasted' ? 'lost' : 'saved'} · {weight(total.co2e_kg)} carbon emissions {kind === 'wasted' ? 'associated' : 'avoided'}</Text>
      {previous ? <Text style={styles.meta}>{change(total.kg, previous.kg, weight)}</Text> : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, padding: theme.spacing.gutter, gap: theme.spacing.lg },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    sections: { gap: theme.spacing.lg },
    segments: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs,
      backgroundColor: theme.colors.track, borderRadius: theme.radii.control, padding: theme.spacing.xs },
    segment: { flex: 1, minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget,
      padding: theme.spacing.sm, justifyContent: 'center', borderRadius: theme.radii.input },
    selected: { backgroundColor: theme.colors.surface },
    segmentText: { ...theme.type.button, color: theme.colors.muted, textAlign: 'center' },
    selectedText: { color: theme.colors.forest },
    hero: { backgroundColor: theme.colors.forest, borderRadius: theme.radii.hero, padding: theme.spacing.gutter, gap: theme.spacing.sm },
    heroLabel: { ...theme.type.cardHeading, color: theme.colors.onForest },
    heroNumber: { ...theme.type.heroNumber, color: theme.colors.onForest },
    heroMeta: { ...theme.type.bodySmall, color: theme.colors.onForestMuted },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.lg, gap: theme.spacing.sm },
    cardTitle: { ...theme.type.cardHeading, color: theme.colors.ink },
    number: { ...theme.type.screenTitle, color: theme.colors.ink },
    meta: { ...theme.type.bodySmall, color: theme.colors.muted },
    track: { backgroundColor: theme.colors.track, height: theme.spacing.tileGap, borderRadius: theme.radii.chip, overflow: 'hidden' },
    meter: { height: '100%', backgroundColor: theme.colors.chartWasted, borderRadius: theme.radii.chip },
    reason: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  });
}
