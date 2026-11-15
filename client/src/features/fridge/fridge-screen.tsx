import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError, useApi } from '@/api';
import type { Item, Storage } from '@/api/types';
import { useNoticeBottomClearance } from '@/components/notice/notice';
import { AppIcon } from '@/components/ui/app-icon';
import { AppButton } from '@/components/ui/app-button';
import { FadeIn } from '@/components/ui/fade-in';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { groupItems } from '@/features/fridge/fridge-utils';
import { BatchUndoToast, type BatchUndo } from '@/features/fridge/batch-undo-toast';
import { groupIcon, ItemRow } from '@/features/fridge/item-row';
import { MoveSheet, storageLabel } from '@/features/fridge/move-sheet';
import { StorageSegmented } from '@/features/fridge/storage-segmented';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { UndoToast } from '@/features/remove/undo-toast';
import { RESTORE_WINDOW_MS, UNDO_TOAST_MS, useRemovalUndo } from '@/features/remove/use-removal-undo';
import { type AppTheme, useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { usePreferences } from '@/settings/preferences';

interface FridgeState {
  status: 'loading' | 'success' | 'error';
  items: Item[];
  error: string | null;
  loadedStorage: Storage | null;
}

export function FridgeScreen() {
  const theme = useTheme();
  const { api } = useApi();
  const { units } = usePreferences();
  const [storage, setStorage] = useState<Storage>('fridge');
  const [removing, setRemoving] = useState<Item | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [moved, setMoved] = useState<Item | null>(null);
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchPending, setBatchPending] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batches, setBatches] = useState<BatchUndo[]>([]);
  const [undoHeight, setUndoHeight] = useState(0);
  const batchWorking = useRef(false);
  const restoringBatches = useRef(new Set<number>());
  const batchSequence = useRef(0);
  const lastOutcome = useRef<'used' | 'donated'>('used');
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<FridgeState>({
    status: 'loading',
    items: [],
    error: null,
    loadedStorage: null,
  });
  const requestSequence = useRef(0);
  const mutations = useRef({ version: 0, items: new Map<string, { version: number; item: Item }>() });
  const { entries, remember, undo, dismiss } = useRemovalUndo(applyItem);
  const hasUndo = batches.length > 0 || entries.length > 0;
  const styles = createStyles(theme);
  const setNoticeClearance = useNoticeBottomClearance();

  useFocusEffect(useCallback(() => {
    setNoticeClearance(hasUndo ? undoHeight + theme.spacing.sm : 0);
    return () => setNoticeClearance(0);
  }, [hasUndo, setNoticeClearance, theme.spacing.sm, undoHeight]));

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

  async function removeSelected(outcome: 'used' | 'donated') {
    if (batchWorking.current || selected.length === 0) return;
    batchWorking.current = true; lastOutcome.current = outcome; setBatchPending(true); setBatchError('');
    try {
      let items: Item[];
      let remaining: string[] = [];
      try {
        ({ items } = await api.removeBatch({ item_ids: selected, outcome }));
      } catch (cause) {
        if (!isApiError(cause) || cause.status !== 409 || cause.code !== 'already_removed') throw cause;
        // A batch conflict writes nothing and only says that at least one item is removed.
        // Reload before offering Undo, rather than assuming every selected item was removed.
        const response = await api.getItems({ storage, include_removed: true });
        const refreshed = 'items' in response ? response.items : response.sections.flatMap((section) => section.items);
        refreshed.forEach(applyItem);
        items = refreshed.filter((item) => selected.includes(item.id) && item.removed_at !== null);
        // Items the conflict did not remove stay selected, so the user can retry them.
        remaining = refreshed.filter((item) => selected.includes(item.id) && item.removed_at === null).map((item) => item.id);
      }
      items.forEach(applyItem);
      if (items.length > 0) {
        const entry: BatchUndo = { id: ++batchSequence.current, itemIds: items.map((item) => item.id), outcome, expiresAt: Math.min(...items.map((item) => Date.parse(item.removed_at!))) + RESTORE_WINDOW_MS, toastExpiresAt: Date.now() + UNDO_TOAST_MS, pending: false, error: '' };
        dismiss();
        setBatches([entry]);
      }
      if (remaining.length > 0) {
        setSelected(remaining);
        setBatchError('Some items were already removed. Try again to remove the rest.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      setSelecting(false); setSelected([]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      setBatchError(cause instanceof Error ? cause.message : 'Couldn’t remove these items. Try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally { batchWorking.current = false; setBatchPending(false); }
  }
  async function undoBatch(entry: BatchUndo) {
    if (restoringBatches.current.has(entry.id)) return;
    restoringBatches.current.add(entry.id);
    setBatches((current) => current.map((batch) => batch.id === entry.id ? { ...batch, pending: true, error: '' } : batch));
    try {
      const { items } = await api.restoreBatch(entry.itemIds);
      items.forEach(applyItem);
      setBatches((current) => current.filter((batch) => batch.id !== entry.id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      setBatches((current) => current.map((batch) => batch.id === entry.id ? { ...batch, pending: false, error: cause instanceof Error ? cause.message : 'Couldn’t undo removal. Try again.' } : batch));
    } finally { restoringBatches.current.delete(entry.id); }
  }
  function done() { if (!batchWorking.current) { setSelecting(false); setSelected([]); setBatchError(''); } }

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

  const sections = groupItems(state.items.filter((item) => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const loading = state.status === 'loading' || (state.status === 'success' && state.loadedStorage !== storage);
  const emptyTitle = `Nothing in your ${storage} yet`;

  const content = (
    <SafeAreaView style={styles.screen} edges={selecting ? ['top', 'bottom'] : ['top']}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Your food</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Recently removed" testID="fridge.recentlyRemoved" onPress={() => router.push('/removed')} style={styles.history}>
            <AppIcon name="history" color={theme.colors.forest} size={theme.sizes.icon} />
          </Pressable>
          {selecting ? <AppButton label="Done" testID="fridge.selection.done" variant="outline" disabled={batchPending} onPress={done} />
            : state.items.length > 0 ? <AppButton label="Select" testID="fridge.selection.start" variant="outline" onPress={() => { setSelected([]); setSelecting(true); }} /> : null}
        </View>
      </View>
      {selecting ? <Text accessibilityLiveRegion="polite" style={styles.confirmation} testID="fridge.selection.count">{selected.length} selected</Text> : null}
      <StorageSegmented value={storage} onChange={(value) => { if (!batchWorking.current) { setStorage(value); setSelected([]); setSearch(''); setBatchError(''); } }} />
      {state.items.length > 0 && !selecting ? <View style={styles.searchRow}>
        <TextInput accessibilityLabel="Search food" placeholder="Search" placeholderTextColor={theme.colors.muted} testID="fridge.search.input" value={search} onChangeText={setSearch} style={styles.search} />
      </View> : null}
      {moved ? <FadeIn testID="fridge.move.confirmation">
        <Text accessibilityLiveRegion="polite" style={styles.confirmation}>Moved to {storageLabel(moved.storage)}</Text>
      </FadeIn> : null}
      <ScrollView
        accessibilityLabel={`${storage} food`}
        style={styles.content}
        contentContainerStyle={[styles.listContent, hasUndo && { paddingBottom: theme.spacing.xxl + undoHeight + theme.spacing.sm }]}
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
            title={state.items.length ? 'No matching food' : emptyTitle}
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
                    selecting={selecting}
                    units={units}
                    onOpen={() => { done(); router.push(`/item/${item.id}`); }}
                    selected={selected.includes(item.id)}
                    disabled={batchPending}
                    onSelect={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : current.length < 100 ? [...current, item.id] : current)}
                    onRemove={() => setRemoving(item)}
                    onMove={() => setMoving(item)}
                  />
                ))}
              </View>
            </FadeIn>
        ))}
      </ScrollView>
      {selecting ? <View style={styles.batchBar} testID="fridge.selection.bar">
        {batchPending ? <SkeletonRows testID="fridge.batch.loading" /> : null}
        {batchError ? <><Text accessibilityRole="alert" style={styles.error} testID="fridge.batch.error">{batchError}</Text>
          <AppButton label="Try again" testID="fridge.batch.retry" disabled={batchPending} onPress={() => void removeSelected(lastOutcome.current)} /></> : null}
        <AppButton label="Used them" testID="fridge.batch.used" disabled={batchPending || selected.length === 0} onPress={() => void removeSelected('used')} />
        <AppButton label="Shared them" testID="fridge.batch.donated" variant="outline" disabled={batchPending || selected.length === 0} onPress={() => void removeSelected('donated')} />
      </View> : null}
      {hasUndo ? <View style={styles.undoOverlay} testID="fridge.undoOverlay"
        onLayout={(event) => setUndoHeight(event.nativeEvent.layout.height)}>
        <ScrollView style={styles.toasts} contentContainerStyle={styles.toastContent}>
          {batches.map((entry) => <BatchUndoToast key={entry.id} entry={entry} onUndo={() => void undoBatch(entry)}
            onDismiss={() => setBatches((current) => current.filter((batch) => batch.id !== entry.id))} />)}
          {entries.map((entry) => (
            <UndoToast key={entry.item.id} entry={entry} onUndo={() => void undo(entry)} onDismiss={() => dismiss(entry.item.id)} />
          ))}
        </ScrollView>
      </View> : null}
      {removing ? (
        <RemoveSheet
          key={removing.id}
          item={removing}
          units={units}
          onClose={() => setRemoving(null)}
          onRemoved={(item) => { applyItem(item); setBatches([]); remember(item); }}
        />
      ) : null}
      {moving ? <MoveSheet key={moving.id} item={moving} onClose={() => setMoving(null)}
        onMoved={(item) => { applyItem(item); setMoved(item); }} /> : null}
    </SafeAreaView>
  );
  // A native full-screen modal replaces the tab bar during selection without changing shared navigation.
  return selecting ? <Modal visible animationType={reducedMotion ? 'fade' : 'none'} testID="fridge.selection.modal" onRequestClose={done}>{content}</Modal> : content;
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
    header: { paddingTop: theme.spacing.lg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    history: { minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    search: { ...theme.type.body, color: theme.colors.ink, backgroundColor: theme.colors.surface, borderRadius: theme.radii.input, minHeight: theme.sizes.input, padding: theme.spacing.md, flex: 1 },
    batchBar: { gap: theme.spacing.sm, paddingBottom: theme.spacing.sm },
    error: { ...theme.type.body, color: theme.colors.urgentInk },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    confirmation: { ...theme.type.body, color: theme.colors.forest },
    content: { flex: 1 },
    undoOverlay: { position: 'absolute', pointerEvents: 'box-none', bottom: theme.spacing.sm, left: theme.spacing.gutter, right: theme.spacing.gutter, maxHeight: '40%' },
    toasts: { pointerEvents: 'box-none', flexGrow: 0, flexShrink: 1 },
    toastContent: { pointerEvents: 'box-none', gap: theme.spacing.sm },
    listContent: { flexGrow: 1, gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
    section: { gap: theme.spacing.sm },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
    sectionTitle: { ...theme.type.meta, color: theme.colors.muted, fontWeight: '600', textTransform: 'uppercase' },
    sectionCard: { borderRadius: theme.radii.row, overflow: 'hidden' },
  });
}
