import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import type { Item, Storage } from '@/api/types';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { groupItems } from '@/features/fridge/fridge-utils';
import { groupIcon, ItemRow } from '@/features/fridge/item-row';
import { MoveSheet, storageLabel } from '@/features/fridge/move-sheet';
import { StorageSegmented } from '@/features/fridge/storage-segmented';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { UndoToast } from '@/features/remove/undo-toast';
import { useRemovalUndo } from '@/features/remove/use-removal-undo';
import { type AppTheme, useTheme } from '@/theme';

interface FridgeState {
  status: 'loading' | 'success' | 'error';
  items: Item[];
  error: string | null;
  loadedStorage: Storage | null;
}

export function FridgeScreen() {
  const theme = useTheme();
  const { api } = useApi();
  const [storage, setStorage] = useState<Storage>('fridge');
  const [removing, setRemoving] = useState<Item | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [moved, setMoved] = useState<Item | null>(null);
  const [state, setState] = useState<FridgeState>({
    status: 'loading',
    items: [],
    error: null,
    loadedStorage: null,
  });
  const requestSequence = useRef(0);
  const mutations = useRef({ version: 0, items: new Map<string, { version: number; item: Item }>() });
  const { entries, remember, undo } = useRemovalUndo(applyItem);
  const styles = createStyles(theme);

  useEffect(() => {
    if (!moved) return;
    const timeout = setTimeout(() => setMoved(null), 5000);
    return () => clearTimeout(timeout);
  }, [moved]);

  const load = useCallback(
    async (forceSkeleton = false) => {
      const request = ++requestSequence.current;
      const version = mutations.current.version;
      setState((current) => ({
        ...current,
        status: forceSkeleton || current.loadedStorage !== storage ? 'loading' : current.status,
        error: null,
      }));
      try {
        const response = await api.getItems({ storage });
        if (request !== requestSequence.current) return;
        let items = 'items' in response ? response.items : response.sections.flatMap((section) => section.items);
        // Reconcile changes made while this list request was in flight.
        for (const [id, mutation] of mutations.current.items) {
          if (mutation.version > version) items = replaceItem(items, mutation.item, storage);
          else mutations.current.items.delete(id);
        }
        setState({ status: 'success', items, error: null, loadedStorage: storage });
      } catch (cause) {
        if (request !== requestSequence.current) return;
        setState((current) => ({
          ...current,
          status: 'error',
          error: cause instanceof Error ? cause.message : 'We couldn’t load your food. Try again.',
        }));
      }
    },
    [api, storage],
  );

  function applyItem(item: Item) {
    const version = ++mutations.current.version;
    mutations.current.items.set(item.id, { version, item });
    setState((current) => ({ ...current, items: replaceItem(current.items, item, current.loadedStorage) }));
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.resolve().then(() => {
        if (active) return load();
      });
      return () => {
        active = false;
        requestSequence.current += 1;
      };
    }, [load]),
  );

  const sections = groupItems(state.items);
  const loading = state.status === 'loading' || (state.status === 'success' && state.loadedStorage !== storage);
  const emptyTitle = `Nothing in your ${storage} yet`;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Your food</Text>
      </View>
      <StorageSegmented value={storage} onChange={setStorage} />
      {moved ? <FadeIn testID="fridge.move.confirmation">
        <Text accessibilityLiveRegion="polite" style={styles.confirmation}>Moved to {storageLabel(moved.storage)}</Text>
      </FadeIn> : null}
      <ScrollView
        accessibilityLabel={`${storage} food`}
        style={styles.content}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}>
        {loading ? <SkeletonRows testID="fridge.loading.skeleton" /> : null}
        {state.status === 'error' ? (
          <StateView
            actionLabel="Try again"
            actionTestID="fridge.error.retry"
            icon="cloud-off-outline"
            message={state.error ?? 'We couldn’t load your food. Try again.'}
            onAction={() => void load(true)}
            testID="fridge.error.state"
            title="Couldn’t load your food"
          />
        ) : null}
        {!loading && state.status === 'success' && sections.length === 0 ? (
          <StateView
            actionLabel="Add food"
            actionTestID="fridge.empty.add"
            icon="fridge-outline"
            message="Snap a photo, scan a receipt or type what you bought."
            onAction={() => router.push('/add-modal')}
            testID="fridge.empty.state"
            title={emptyTitle}
          />
        ) : null}
        {!loading && state.status === 'success' && sections.map((section, sectionIndex) => (
            <FadeIn
              key={`${storage}-${section.foodGroup}`}
              delay={Math.min(sectionIndex, theme.motion.maxStaggerItems - 1) * theme.motion.staggerMs}
              style={styles.section}
              testID={`fridge.group.${section.foodGroup}`}>
              <View style={styles.sectionHeader}>
                <AppIcon
                  name={groupIcon(section.foodGroup)}
                  color={theme.foodGroups[section.foodGroup].stroke}
                  size={theme.sizes.iconSmall}
                />
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {section.label} · {section.items.length}
                </Text>
              </View>
              <View style={styles.sectionCard}>
                {section.items.map((item, itemIndex) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    last={itemIndex === section.items.length - 1}
                    onRemove={() => setRemoving(item)}
                    onMove={() => setMoving(item)}
                  />
                ))}
              </View>
            </FadeIn>
        ))}
      </ScrollView>
      {entries.length > 0 ? (
        <ScrollView style={styles.toasts} contentContainerStyle={styles.toastContent}>
          {entries.map((entry) => (
            <UndoToast key={entry.item.id} entry={entry} onUndo={() => void undo(entry)} />
          ))}
        </ScrollView>
      ) : null}
      {removing ? (
        <RemoveSheet
          key={removing.id}
          item={removing}
          onClose={() => setRemoving(null)}
          onRemoved={(item) => { applyItem(item); remember(item); }}
        />
      ) : null}
      {moving ? <MoveSheet key={moving.id} item={moving} onClose={() => setMoving(null)}
        onMoved={(item) => { applyItem(item); setMoved(item); }} /> : null}
    </SafeAreaView>
  );
}

function replaceItem(items: Item[], item: Item, storage: Storage | null): Item[] {
  const next = items.filter((candidate) => candidate.id !== item.id);
  if (!item.removed_at && item.storage === storage) next.push(item);
  return next;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: {
      backgroundColor: theme.colors.ground,
      flex: 1,
      gap: theme.spacing.lg,
      paddingHorizontal: theme.spacing.gutter,
    },
    header: { paddingTop: theme.spacing.lg },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    confirmation: { ...theme.type.body, color: theme.colors.forest },
    content: { flex: 1 },
    toasts: { flexGrow: 0, flexShrink: 1, maxHeight: '40%' },
    toastContent: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
    listContent: { flexGrow: 1, gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
    section: { gap: theme.spacing.sm },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
    sectionTitle: { ...theme.type.meta, color: theme.colors.muted, fontWeight: '600', textTransform: 'uppercase' },
    sectionCard: { borderRadius: theme.radii.row, overflow: 'hidden' },
  });
}
