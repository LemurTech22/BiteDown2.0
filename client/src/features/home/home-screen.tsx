import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type Item, type Recipe, type Tip } from '@/api';
import { useAuth } from '@/auth/auth-provider';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { ExpiryBadge } from '@/features/fridge/expiry-badge';
import { FOOD_GROUPS, quantityLabel } from '@/features/fridge/fridge-utils';
import { groupIcon } from '@/features/fridge/item-row';
import { formatWeight, usePreferences } from '@/settings/preferences';
import { deviceStore } from '@/storage/key-value-store';
import { type AppTheme, useTheme } from '@/theme';

interface HomeData { items: Item[]; recipe: Recipe | null; tips: Tip[]; saved: number; dismissed: string[] }
const tipKey = (tip: Tip) => `${tip.code}:${tip.message}`;

export function HomeScreen() {
  const { api } = useApi();
  const { user } = useAuth();
  const { units } = usePreferences();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [tipError, setTipError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const storeKey = `home.dismissedTips.${user?.id ?? 'current'}`;
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const [food, impact, tips, recipes, dismissed] = await Promise.all([
        api.getItems(), api.getImpact('month'), api.getTips(), api.suggestRecipes({ max_results: 1 }), deviceStore.get(storeKey),
      ]);
      if (request !== sequence.current) return;
      let keys: string[] = [];
      try { const parsed: unknown = JSON.parse(dismissed ?? '[]'); if (Array.isArray(parsed)) keys = parsed.filter((key): key is string => typeof key === 'string'); } catch { /* Ignore malformed stored tips. */ }
      const items = 'items' in food ? food.items : food.sections.flatMap((section) => section.items);
      items.sort((a, b) => (a.predicted_expiry ?? '9999').localeCompare(b.predicted_expiry ?? '9999'));
      setData({ items, saved: impact.saved.kg, recipe: recipes.recipes[0] ?? null, tips: tips.tips, dismissed: keys });
    } catch (cause) {
      reportServerError(cause);
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'Couldn’t load Home. Try again.');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [api, storeKey]);
  useFocusEffect(useCallback(() => { void load(); return () => { sequence.current += 1; }; }, [load]));

  const tip = data?.items.length ? data.tips.find((candidate) => !data.dismissed.includes(tipKey(candidate))) : undefined;
  async function dismissTip() {
    if (!tip || !data) return;
    const dismissed = [...data.dismissed, tipKey(tip)];
    try {
      await deviceStore.set(storeKey, JSON.stringify(dismissed));
      setData((current) => current ? { ...current, dismissed } : current); setTipError('');
    } catch (cause) { reportServerError(cause); setTipError('Couldn’t dismiss this tip. Try again.'); }
  }

  return <SafeAreaView style={styles.screen} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.meta}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
          <Text accessibilityRole="header" style={styles.title}>Hi{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}</Text>
        </View>
        <IconButton icon="cog-outline" label="Settings" testID="home.settings.button" onPress={() => router.push('/settings')} />
      </View>
      {loading ? <SkeletonRows testID="home.loading.skeleton" /> : error ? <StateView title="Couldn’t load Home" message={error}
        icon="cloud-off-outline" testID="home.error.state" actionLabel="Try again" actionTestID="home.error.retry" onAction={() => void load()} /> : data ? <>
        {tip ? <View style={styles.tip} testID="home.tip.card"><Text style={styles.body}>{tip.message}</Text>
          <IconButton icon="close" label="Dismiss tip" testID="home.tip.dismiss" onPress={() => void dismissTip()} /></View> : null}
        {tipError ? <StateView title="Couldn’t dismiss tip" message={tipError} icon="alert-circle-outline" testID="home.tip.error"
          actionLabel="Try again" actionTestID="home.tip.retry" onAction={() => void dismissTip()} /> : null}
        <View style={styles.section}>
          <View style={styles.header}><Text accessibilityRole="header" style={styles.heading}>Use these first</Text>
            {data.items.length ? <Pressable accessibilityRole="button" accessibilityLabel="See all food" testID="home.fridge.button" onPress={() => router.push('/fridge')} style={styles.link}><Text style={styles.linkText}>See all</Text></Pressable> : null}</View>
          {data.items.length === 0 ? <View style={styles.card} testID="home.empty.state">
            <AppIcon name="fridge-outline" color={theme.colors.forest} /><Text style={styles.body}>Add food and we&apos;ll show what to use first</Text>
            <AppButton label="Add food" testID="home.empty.add" onPress={() => router.push('/add-modal')} />
          </View> : <View style={styles.card}>{data.items.slice(0, 3).map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`} onPress={() => router.push(`/item/${item.id}`)} testID={`home.item.${item.id}`} style={styles.item}>
            <View style={[styles.icon, { backgroundColor: theme.foodGroups[item.food_group].tile }]}><AppIcon name={groupIcon(item.food_group)} color={theme.foodGroups[item.food_group].stroke} /></View>
            <View style={styles.copy}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.meta}>{quantityLabel(item, units)} · {FOOD_GROUPS.find((group) => group.value === item.food_group)?.label}</Text></View>
            <ExpiryBadge item={item} testID={`home.status.${item.id}`} />
          </Pressable>)}</View>}
        </View>
        <View style={styles.section}><Text accessibilityRole="header" style={styles.heading}>Cook tonight</Text>
          {data.items.length && data.recipe ? <Pressable accessibilityRole="button" accessibilityLabel={`Cook tonight: ${data.recipe.title}`}
            testID="home.recipe.card" onPress={() => router.push('/recipes')} style={styles.recipe}>
            <Text style={styles.recipeTitle}>{data.recipe.title}</Text><Text style={styles.recipeMeta}>{data.recipe.minutes} min · Uses {data.recipe.uses_items.length} of your items</Text>
            {data.recipe.uses_items.map((item) => <Text key={item.item_id} style={styles.recipeChip}>{item.name}</Text>)}
          </Pressable> : <View style={styles.card} testID="home.recipe.empty"><Text style={styles.meta}>Recipes appear once you&apos;ve added a few items</Text></View>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${formatWeight(data.saved, units)} saved, view Impact`}
          testID="home.impact.pill" onPress={() => router.push('/impact')} style={styles.impact}>
          <AppIcon name="leaf" color={theme.colors.forest} /><Text style={styles.linkText}>{formatWeight(data.saved, units)} saved</Text>
        </Pressable>
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground }, content: { padding: theme.spacing.gutter, gap: theme.spacing.xl, flexGrow: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm, flexWrap: 'wrap' },
    copy: { flex: 1, gap: theme.spacing.xxs }, title: { ...theme.type.screenTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted }, heading: { ...theme.type.sectionHeading, color: theme.colors.ink }, body: { ...theme.type.body, color: theme.colors.inkSecondary, flexShrink: 1 },
    tip: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center', borderRadius: theme.radii.card, backgroundColor: theme.colors.noteLime, padding: theme.spacing.md },
    section: { gap: theme.spacing.md }, card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.lg, gap: theme.spacing.md },
    item: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: theme.sizes.itemRow, gap: theme.spacing.md }, itemName: { ...theme.type.rowTitle, color: theme.colors.ink },
    icon: { width: theme.sizes.itemIcon, height: theme.sizes.itemIcon, borderRadius: theme.radii.input, alignItems: 'center', justifyContent: 'center' },
    link: { minHeight: theme.sizes.touchTarget, minWidth: theme.sizes.touchTarget, justifyContent: 'center' }, linkText: { ...theme.type.button, color: theme.colors.forest },
    recipe: { backgroundColor: theme.colors.forest, padding: theme.spacing.gutter, borderRadius: theme.radii.hero, gap: theme.spacing.md, minHeight: theme.sizes.touchTarget },
    recipeTitle: { ...theme.type.sheetTitle, color: theme.colors.onForest }, recipeMeta: { ...theme.type.meta, color: theme.colors.onForestMuted },
    recipeChip: { ...theme.type.badge, color: theme.colors.onForestChip, backgroundColor: theme.colors.forestChip, borderRadius: theme.radii.chip, padding: theme.spacing.sm, alignSelf: 'flex-start' },
    impact: { minHeight: theme.sizes.touchTarget, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.limeTint, borderRadius: theme.radii.round, padding: theme.spacing.md },
  });
}
