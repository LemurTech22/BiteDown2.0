import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

import { MacroStrip } from './macro-strip';
import { rememberRecipes, type StoredRecipe } from './recipe-store';
import { expiryPresentation, recipeMeta, visibleRecipes } from './recipe-utils';

type RecipeState = { status: 'loading' | 'success' | 'error'; entries: StoredRecipe[]; error: string | null };

export function RecipesScreen() {
  const { api } = useApi();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const styles = createStyles(theme);
  const [onlyHave, setOnlyHave] = useState(true);
  const [expiring, setExpiring] = useState(true);
  const [quick, setQuick] = useState(false);
  const [vegetarian, setVegetarian] = useState(false);
  const [state, setState] = useState<RecipeState>({ status: 'loading', entries: [], error: null });
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setState({ status: 'loading', entries: [], error: null });
    try {
      const response = await api.suggestRecipes({ max_results: 10, ...(vegetarian ? { dietary: ['vegetarian'] } : {}) });
      if (request !== requestSequence.current) return;
      setState({ status: 'success', entries: rememberRecipes(api, response.recipes), error: null });
    } catch (cause) {
      if (request !== requestSequence.current) return;
      setState({ status: 'error', entries: [], error: cause instanceof Error ? cause.message : 'Couldn’t load recipes. Try again.' });
    }
  }, [api, vegetarian]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]));

  const visible = visibleRecipes(state.entries, onlyHave, quick, expiring);
  const hiddenByOnlyHave = onlyHave && visibleRecipes(state.entries, false, quick, expiring).length > 0;
  const filters = [
    { id: 'onlyHave', label: 'Only what I have', on: onlyHave, toggle: () => setOnlyHave(!onlyHave) },
    { id: 'expiring', label: 'Expiring first', on: expiring, toggle: () => setExpiring(!expiring) },
    { id: 'quick', label: 'Under 30 min', on: quick, toggle: () => setQuick(!quick) },
    { id: 'vegetarian', label: 'Vegetarian', on: vegetarian, toggle: () => setVegetarian(!vegetarian) },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.screen} testID="recipes.screen.root">
      <ScrollView accessibilityLabel="Recipes" contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title} testID="recipes.title.text">Recipes</Text>
          <IconButton icon="refresh" label="New suggestions" testID="recipes.refresh.button" onPress={() => void load()} />
        </View>
        <View accessibilityLabel="Filters" style={styles.filters} testID="recipes.filters.group">
          {filters.map((filter) => (
            <Pressable key={filter.id} accessibilityRole="button" accessibilityLabel={filter.label}
              accessibilityState={{ selected: filter.on }} accessibilityValue={{ text: filter.on ? 'On' : 'Off' }}
              testID={'recipes.filter.' + filter.id} onPress={filter.toggle} style={styles.chipTarget}>
              <View style={[styles.chip, filter.on && styles.selectedChip]}>
                {filter.on ? <AppIcon name="check" color={theme.colors.onForest} size={theme.sizes.iconSmall} /> : null}
                <Text style={[styles.chipLabel, filter.on && styles.selectedLabel]}>{filter.label}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        {state.status === 'loading' ? <SkeletonRows testID="recipes.loading.skeleton" /> : null}
        {state.status === 'error' ? <StateView icon="cloud-off-outline" title="Couldn’t load recipes"
          message={state.error ?? 'Try again in a moment.'} testID="recipes.error.state"
          actionLabel="Try again" actionTestID="recipes.error.retry" onAction={() => void load()} /> : null}
        {state.status === 'success' && visible.length === 0 ? (
          <StateView icon="pot-steam-outline" testID="recipes.empty.state"
            title={state.entries.length === 0 ? 'No recipes yet' : hiddenByOnlyHave ? 'Nothing from just what you have' : 'No recipes match'}
            message={state.entries.length === 0 ? 'Add some food to your fridge and we’ll suggest what to cook.' : hiddenByOnlyHave ? 'Every idea needs a few extra ingredients.' : 'Try turning a filter off.'}
            actionLabel={hiddenByOnlyHave ? 'Show recipes that need a few things' : state.entries.length === 0 ? 'Try again' : 'Clear filters'}
            actionTestID={hiddenByOnlyHave ? 'recipes.empty.showMissing' : 'recipes.empty.retry'}
            onAction={() => { if (hiddenByOnlyHave) setOnlyHave(false); else if (!state.entries.length) void load(); else { setOnlyHave(false); setQuick(false); setExpiring(false); setVegetarian(false); } }} />
        ) : null}
        {state.status === 'success' && visible.length > 0 ? (
          <FadeIn key={visible[0].key} style={styles.results} testID="recipes.results.list">
            <RecipeCard entry={visible[0]} hero />
            {visible.length > 1 ? <View style={styles.more}>
              <Text accessibilityRole="header" style={styles.section}>More from your fridge</Text>
              <View style={styles.rows}>{visible.slice(1).map((entry, index) => <FadeIn key={entry.key}
                delay={reducedMotion ? 0 : Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.staggerMs}>
                <RecipeCard entry={entry} last={index === visible.length - 2} />
              </FadeIn>)}</View>
            </View> : null}
          </FadeIn>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function RecipeCard({ entry, hero = false, last = false }: { entry: StoredRecipe; hero?: boolean; last?: boolean }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { recipe, key } = entry;
  const macros = recipe.macros;
  const meta = recipeMeta(recipe) + (!hero && macros ? ' · ' + macros.kcal + ' kcal · ' + macros.protein_g + ' g protein' : '');
  const macroLabel = macros ? ', estimated per serving: ' + macros.kcal + ' kcal, ' + macros.protein_g + ' g protein, ' + macros.carbs_g + ' g carbs, ' + macros.fat_g + ' g fat' : ', macros unavailable';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={recipe.title + ', ' + meta + macroLabel + ', uses ' + recipe.uses_items.length + ' items. ' + (hero ? 'Cook it' : 'View recipe')}
      accessibilityHint="Opens the recipe" testID={'recipes.card.' + key}
      onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: key } })}
      style={({ pressed }) => [hero ? styles.hero : styles.row, !hero && !last && styles.divider, pressed && styles.pressed]}>
      {hero ? <Text style={styles.eyebrow}>Best match · uses {recipe.uses_items.length} {recipe.uses_items.length === 1 ? 'item' : 'items'} from your fridge</Text> : null}
      <Text style={hero ? styles.heroTitle : styles.rowTitle}>{recipe.title}</Text>
      {hero ? <View style={styles.itemChips}>{recipe.uses_items.map((item) => {
        const expiry = expiryPresentation(item.predicted_expiry).label;
        return <Text key={item.item_id} style={styles.itemChip}>{item.name}{expiry ? ' · ' + expiry : ''}</Text>;
      })}</View> : null}
      {hero ? <MacroStrip macros={macros} onCard testID={'recipes.macros.' + key} /> : null}
      <View style={styles.cardFooter}>
        <Text style={hero ? styles.heroMeta : styles.meta}>{meta}{recipe.missing_items.length ? ' · needs ' + recipe.missing_items.length + ' more' : ''}</Text>
        <Text style={hero ? styles.cook : styles.uses}>{hero ? 'Cook it' : 'Uses ' + recipe.uses_items.length}</Text>
      </View>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, gap: theme.spacing.lg, padding: theme.spacing.gutter, paddingBottom: theme.spacing.xxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md },
    title: { ...theme.type.screenTitle, color: theme.colors.ink, flexShrink: 1 },
    filters: { flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.spacing.sm },
    chipTarget: { minHeight: theme.sizes.touchTarget, justifyContent: 'center', maxWidth: '100%' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, borderRadius: theme.radii.round, borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, minHeight: theme.sizes.filterChip, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.tileInner },
    selectedChip: { backgroundColor: theme.colors.forest, borderColor: theme.colors.forest },
    chipLabel: { ...theme.type.formLabel, color: theme.colors.ink, flexShrink: 1 },
    selectedLabel: { color: theme.colors.onForest },
    results: { gap: theme.spacing.lg },
    more: { gap: theme.spacing.sm },
    rows: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.row, overflow: 'hidden' },
    divider: { borderBottomColor: theme.colors.hairline, borderBottomWidth: theme.sizes.borderHairline },
    section: { ...theme.type.sectionHeading, color: theme.colors.ink },
    hero: { backgroundColor: theme.colors.forest, padding: theme.spacing.sheetSection, borderRadius: theme.radii.hero, gap: theme.spacing.md },
    eyebrow: { ...theme.type.badge, color: theme.colors.onForestMuted },
    heroTitle: { ...theme.type.sheetTitleCompact, color: theme.colors.onForest },
    itemChips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    itemChip: { ...theme.type.badge, backgroundColor: theme.colors.forestChip, color: theme.colors.onForestChip, borderRadius: theme.radii.chip, paddingHorizontal: theme.spacing.tileGap, paddingVertical: theme.spacing.xs },
    cardFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    heroMeta: { ...theme.type.meta, color: theme.colors.onForestMuted, flexShrink: 1 },
    cook: { ...theme.type.rowTitle, color: theme.colors.onForest, paddingVertical: theme.spacing.sm },
    row: { backgroundColor: theme.colors.surface, padding: theme.spacing.lg, minHeight: theme.sizes.touchTarget, gap: theme.spacing.xxs },
    rowTitle: { ...theme.type.rowTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted, flexShrink: 1 },
    uses: { ...theme.type.badge, backgroundColor: theme.colors.limeTint, color: theme.colors.forest, borderRadius: theme.radii.chip, paddingHorizontal: theme.spacing.tileGap, paddingVertical: theme.spacing.xs },
    pressed: { opacity: 0.85 },
  });
}
