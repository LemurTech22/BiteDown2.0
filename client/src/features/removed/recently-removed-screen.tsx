import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type Item } from '@/api';
import { RESTORE_WINDOW_MS } from '@/api/removal-window';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { storageLabel } from '@/features/fridge/move-sheet';
import { usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

const OUTCOME_LABELS = { used: 'Used', donated: 'Shared', thrown_out: 'Thrown out' };

function relativeTime(removedAt: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(removedAt));
  const minutes = Math.floor(elapsed / (60 * 1000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

export function RecentlyRemovedScreen() {
  const { api } = useApi();
  const { units } = usePreferences();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const working = useRef(new Set<string>());
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setStatus('loading');
    try {
      const response = await api.getItems({ include_removed: true });
      if (request !== requestSequence.current) return;
      const all = 'items' in response ? response.items : response.sections.flatMap((section) => section.items);
      const now = Date.now();
      setItems(all.filter((item) => {
        const removedAt = item.removed_at ? Date.parse(item.removed_at) : NaN;
        // No upper bound: a server clock slightly ahead of the device must not hide a just-removed item.
        return removedAt > now - RESTORE_WINDOW_MS;
      }).sort((a, b) => Date.parse(b.removed_at!) - Date.parse(a.removed_at!)));
      setStatus('success');
    } catch (cause) {
      if (request !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Couldn’t load recently removed food. Try again.');
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  async function putBack(item: Item) {
    if (working.current.has(item.id)) return;
    working.current.add(item.id);
    setPending((current) => [...current, item.id]);
    setRowErrors((current) => ({ ...current, [item.id]: '' }));
    try {
      const { item: restored } = await api.restoreItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setMessage(`${restored.name} is back in ${storageLabel(restored.storage)}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      setRowErrors((current) => ({ ...current, [item.id]: cause instanceof Error ? cause.message : 'Couldn’t put this food back. Try again.' }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      working.current.delete(item.id);
      setPending((current) => current.filter((id) => id !== item.id));
    }
  }

  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
    <ScrollView contentContainerStyle={styles.content}>
      {status === 'loading' ? <SkeletonRows testID="removed.loading" /> : null}
      {status === 'error' ? <StateView icon="cloud-off-outline" title="Couldn’t load recently removed food" message={error}
        testID="removed.error" actionLabel="Try again" actionTestID="removed.retry" onAction={() => void load()} /> : null}
      {status === 'success' && items.length === 0 ? <StateView icon="history" title="Nothing removed in the last 7 days"
        message="Food you use, share or throw out appears here for 7 days." testID="removed.empty" /> : null}
      {status === 'success' && items.map((item) => <View key={item.id} style={styles.row} testID={`removed.item.${item.id}`}>
        <View style={styles.rowContent}>
          <View style={styles.copy}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{quantityLabel(item, units)}</Text>
            <Text style={styles.meta}>{item.outcome ? OUTCOME_LABELS[item.outcome] : 'Removed'} · {relativeTime(item.removed_at!)}</Text>
          </View>
          <AppButton label={rowErrors[item.id] ? 'Try again' : 'Put back'} accessibilityLabel={`Put back ${item.name}`}
            testID={`removed.putBack.${item.id}`} loading={pending.includes(item.id)} variant="outline" onPress={() => void putBack(item)} />
        </View>
        {rowErrors[item.id] ? <Text accessibilityRole="alert" style={styles.error}>{rowErrors[item.id]}</Text> : null}
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground, paddingHorizontal: theme.spacing.gutter },
    content: { flexGrow: 1, gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
    message: { ...theme.type.body, color: theme.colors.forest },
    row: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.row, padding: theme.spacing.md, gap: theme.spacing.sm },
    rowContent: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' },
    copy: { flex: 1, gap: theme.spacing.xxs },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    error: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
  });
}
