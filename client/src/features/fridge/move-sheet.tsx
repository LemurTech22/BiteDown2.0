import { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type Item, type Storage } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

const STORAGES: { value: Storage; label: string }[] = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'freezer', label: 'Freezer' },
];

export function storageLabel(storage: Storage): string {
  return STORAGES.find((option) => option.value === storage)!.label;
}

export function MoveSheet({ item, onClose, onMoved }: {
  item: Item;
  onClose: () => void;
  onMoved: (item: Item) => void;
}) {
  const { api } = useApi();
  const styles = createStyles(useTheme());
  const reducedMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const destination = useRef<Storage | null>(null);
  const submitting = useRef(false);

  async function move(storage: Storage) {
    if (submitting.current) return;
    submitting.current = true;
    destination.current = storage;
    setPending(true);
    setError('');
    try {
      const { item: updated } = await api.updateItem(item.id, { storage });
      onMoved(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t move this item. Try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Modal visible animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet"
      onRequestClose={() => { if (!submitting.current) onClose(); }} testID="fridge.move.sheet">
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.title}>Move {item.name} to…</Text>
            {pending ? <SkeletonRows testID="fridge.move.skeleton" /> : STORAGES.filter((option) => option.value !== item.storage)
              .map((option) => <AppButton key={option.value} label={option.label}
                accessibilityLabel={`Move ${item.name} to ${option.label}`}
                testID={`fridge.move.${option.value}`} onPress={() => void move(option.value)} variant="outline" />)}
            {error ? <StateView icon="alert-circle-outline" title="Couldn’t move food" message={error}
              testID="fridge.move.error" actionLabel="Try again" actionTestID="fridge.move.retry"
              onAction={() => { if (destination.current) void move(destination.current); }} /> : null}
            <AppButton label="Cancel" testID="fridge.move.cancel" onPress={onClose} disabled={pending} variant="outline" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, justifyContent: 'flex-end' },
    sheet: { padding: theme.spacing.gutter, gap: theme.spacing.sheetSection },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink },
  });
}
