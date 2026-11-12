import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type Item, type Recipe, useApi } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { formatWeight, usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

import { MacroStrip } from './macro-strip';
import { getRecipe, markRecipeItemUsed, usedRecipeItemIds } from './recipe-store';
import { expiryPresentation } from './recipe-utils';

function backToRecipes() {
  if (router.canGoBack()) router.back();
  else router.replace('/recipes');
}

export function RecipeDetailScreen() {
  const { api } = useApi();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const key = Array.isArray(id) ? id[0] : id;
  const recipe = key ? getRecipe(api, key) : undefined;
  const theme = useTheme();
  const styles = createStyles(theme);
  if (!recipe) return (
    <SafeAreaView style={styles.screen} testID="recipeDetail.screen.root">
      <StateView icon="pot-steam-outline" title="Recipe no longer available"
        message="Go back to Recipes to find something to cook."
        testID="recipeDetail.empty.state" actionLabel="Back to Recipes" actionTestID="recipeDetail.empty.back"
        onAction={() => router.replace('/recipes')} />
    </SafeAreaView>
  );
  return <RecipeDetail key={key} recipe={recipe} />;
}

function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const { api } = useApi();
  const { units } = usePreferences();
  const theme = useTheme();
  const styles = createStyles(theme);
  const usedItems = recipe.uses_items.filter((item, index, items) => item.item_id && items.findIndex((candidate) => candidate.item_id === item.item_id) === index);
  const [usedIds, setUsedIds] = useState(() => usedRecipeItemIds(api));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<{ status: 'loading' | 'success' | 'error'; items: Item[]; error: string | null }>({ status: 'loading', items: [], error: null });
  const submitting = useRef(false);
  const sequence = useRef(0);
  const done = usedItems.length > 0 && usedItems.every((item) => usedIds.has(item.item_id));

  const loadInventory = useCallback(async () => {
    const request = ++sequence.current;
    setInventory({ status: 'loading', items: [], error: null });
    try {
      const response = await api.getItems();
      if (request !== sequence.current) return;
      setInventory({ status: 'success', items: 'items' in response ? response.items : response.sections.flatMap((section) => section.items), error: null });
    } catch (cause) {
      reportServerError(cause);
      if (request !== sequence.current) return;
      setInventory({ status: 'error', items: [], error: cause instanceof Error ? cause.message : 'Couldn’t load serving size. Try again.' });
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return loadInventory(); });
    return () => { active = false; sequence.current += 1; };
  }, [loadInventory]);

  const weights = usedItems.map((ingredient) => inventory.items.find((item) => item.id === ingredient.item_id)?.est_weight_kg);
  const completeWeights = weights.length > 0 && weights.every((weight): weight is number => typeof weight === 'number' && Number.isFinite(weight) && weight > 0);
  const totalKg = completeWeights ? weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) : null;
  const servingGrams = totalKg !== null && recipe.servings && recipe.missing_items.length === 0 ? Math.round(totalKg * 1000 / recipe.servings) : null;
  const servingLine = [servingGrams !== null ? 'Serving size ' + servingGrams + ' g' : 'Serving size unavailable', recipe.servings ? recipe.servings + (recipe.servings === 1 ? ' serving' : ' servings') : null].filter(Boolean).join(' · ');

  async function madeThis() {
    if (submitting.current || done || usedItems.length === 0) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const completed = usedRecipeItemIds(api);
    const failures: string[] = [];
    // A successful item stays recorded immediately, including across a failed retry or remount.
    for (const item of usedItems) {
      if (completed.has(item.item_id)) continue;
      try {
        await api.removeItem(item.item_id, { outcome: 'used' });
        markRecipeItemUsed(api, item.item_id);
        completed.add(item.item_id);
        setUsedIds(new Set(completed));
      } catch (cause) {
        reportServerError(cause);
        failures.push(item.name + ': ' + (cause instanceof Error ? cause.message : 'Couldn’t mark as used.'));
      }
    }
    submitting.current = false;
    setPending(false);
    if (failures.length) {
      const count = usedItems.filter((item) => completed.has(item.item_id)).length;
      setError('Marked ' + count + ' of ' + usedItems.length + ' items used. ' + failures.join(' ') + ' Try again to finish.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen} testID="recipeDetail.screen.root">
      <ScrollView accessibilityLabel="Recipe detail" contentContainerStyle={styles.content}>
        <IconButton icon="chevron-left" label="Back" testID="recipeDetail.back.button" onPress={() => { if (!submitting.current) backToRecipes(); }} />
        {done ? <StateView icon="check-circle-outline" title="Marked as made"
          message={usedItems.length + (usedItems.length === 1 ? ' item marked used' : ' items marked used') + (totalKg !== null ? ' · ' + formatWeight(totalKg, units) + ' saved' : '')}
          testID="recipeDetail.done.state" actionLabel="Done" actionTestID="recipeDetail.done.back" onAction={backToRecipes} /> : (
          <>
            <View style={styles.titleBlock}>
              <Text accessibilityRole="header" testID="recipeDetail.title.text" style={styles.title}>{recipe.title}</Text>
              <Text style={styles.meta}>{recipe.minutes} min{recipe.macros ? ' · macros estimated per serving' : ''}</Text>
              {inventory.status === 'success' ? <Text testID="recipeDetail.serving.text" accessibilityHint={servingGrams !== null ? 'Estimated from the total weight of the fridge ingredients per serving.' : undefined} style={styles.serving}>{servingLine}</Text> : null}
            </View>
            {inventory.status === 'loading' ? <SkeletonRows testID="recipeDetail.loading.skeleton" /> : null}
            {inventory.status === 'error' ? <View style={styles.errorBox} testID="recipeDetail.inventory.error">
              <Text accessibilityRole="alert" style={styles.error}>Couldn’t load serving size. {inventory.error}</Text>
              <AppButton label="Try again" testID="recipeDetail.inventory.retry" variant="outline" onPress={() => void loadInventory()} />
            </View> : null}
            <MacroStrip macros={recipe.macros} testID="recipeDetail.macros.strip" />
            <View style={styles.section} testID="recipeDetail.ingredients.list">
              <Text accessibilityRole="header" style={styles.ingredientsTitle}>Ingredients</Text>
              {usedItems.map((item) => {
                const expiry = expiryPresentation(item.predicted_expiry);
                const used = usedIds.has(item.item_id);
                return <View key={item.item_id} accessible accessibilityLabel={item.name + ', ' + (used ? 'Marked used' : 'In your fridge' + (expiry.label ? ' · ' + expiry.label : ''))}
                  style={styles.bulletRow} testID={'recipeDetail.ingredient.' + item.item_id}>
                  <Text accessible={false} style={styles.bullet}>•</Text>
                  <View style={styles.ingredientBody}>
                    <Text style={styles.body}>{item.name}</Text>
                    <Text style={[styles.fridgeBadge, expiry.urgent && !used && styles.urgentBadge]}>{used ? 'Marked used' : 'In your fridge' + (expiry.label ? ' · ' + expiry.label : '')}</Text>
                  </View>
                </View>;
              })}
              {recipe.missing_items.map((name, index) => <View key={index} style={styles.bulletRow} testID={'recipeDetail.missing.' + index}>
                <Text accessible={false} style={styles.bullet}>•</Text><Text style={styles.missingBody}>{name}</Text>
              </View>)}
              {recipe.uses_items.length === 0 && recipe.missing_items.length === 0 ? <Text style={styles.meta}>No ingredients provided.</Text> : null}
              {recipe.missing_items.length > 0 ? <Text testID="recipeDetail.missing.text" style={styles.meta}>You&apos;ll need: {recipe.missing_items.join(', ')}</Text> : null}
            </View>
            <View style={styles.section} testID="recipeDetail.steps.list">
              <Text accessibilityRole="header" style={styles.heading}>Steps</Text>
              {recipe.steps.map((step, index) => <View key={index} accessible accessibilityLabel={'Step ' + (index + 1) + '. ' + step} style={styles.bulletRow} testID={'recipeDetail.step.' + index}>
                <Text accessible={false} style={styles.bullet}>{index + 1}.</Text><Text style={styles.missingBody}>{step}</Text>
              </View>)}
              {recipe.steps.length === 0 ? <Text style={styles.meta}>No steps provided.</Text> : null}
            </View>
            {error ? <View style={styles.errorBox} testID="recipeDetail.error.state">
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
              <AppButton label="Try again" testID="recipeDetail.error.retry" disabled={pending} onPress={() => void madeThis()} />
            </View> : null}
            {usedItems.length === 0 ? <Text style={styles.meta}>There are no fridge items to mark as used.</Text> : null}
          </>
        )}
      </ScrollView>
      {!done ? <View style={styles.footer}>
        <AppButton label="I made this" accessibilityLabel="I made this: mark the fridge ingredients used" testID="recipeDetail.made.button"
          loading={pending} disabled={usedItems.length === 0} onPress={() => void madeThis()} />
      </View> : null}
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, gap: theme.spacing.tileInner, padding: theme.spacing.gutter },
    titleBlock: { gap: theme.spacing.xs },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    serving: { ...theme.type.rowTitle, color: theme.colors.inkSecondary },
    section: { gap: theme.spacing.sm },
    heading: { ...theme.type.cardHeading, color: theme.colors.ink },
    ingredientsTitle: { ...theme.type.cardHeading, fontWeight: '700', color: theme.colors.ink },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
    bullet: { ...theme.type.bodySmall, color: theme.colors.inkSecondary, minWidth: theme.spacing.md },
    body: { ...theme.type.bodySmall, color: theme.colors.inkSecondary, flexShrink: 1 },
    missingBody: { ...theme.type.bodySmall, color: theme.colors.inkSecondary, flex: 1 },
    ingredientBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: theme.spacing.sm },
    fridgeBadge: { ...theme.type.badge, color: theme.colors.forest, backgroundColor: theme.colors.limeTint, borderRadius: theme.radii.chip, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xxs, flexShrink: 1 },
    urgentBadge: { backgroundColor: theme.colors.urgentBg, color: theme.colors.urgentInk },
    footer: { borderTopWidth: theme.sizes.borderHairline, borderTopColor: theme.colors.hairline, paddingHorizontal: theme.spacing.gutter, paddingVertical: theme.spacing.md },
    errorBox: { gap: theme.spacing.sm, backgroundColor: theme.colors.urgentBg, borderRadius: theme.radii.card, padding: theme.spacing.md },
    error: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
  });
}
