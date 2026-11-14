import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { useUndoToastTimeout } from '@/features/remove/use-undo-toast-timeout';
import { AppButton } from '@/components/ui/app-button';
import { FadeIn } from '@/components/ui/fade-in';
import type { UndoEntry } from '@/features/remove/use-removal-undo';
import { type AppTheme, useTheme } from '@/theme';

export function UndoToast({ entry, onUndo, onDismiss }: { entry: UndoEntry; onUndo: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  useUndoToastTimeout(entry.toastExpiresAt, entry.restoring || !!entry.error, onDismiss);
  return (
    <FadeIn style={styles.toast} testID={`remove.toast.${entry.item.id}`}>
      <View style={styles.header}>
        <Text accessibilityLiveRegion="polite" style={styles.label}>{entry.item.name} removed</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID={`undo.dismiss.${entry.item.id}`} onPress={onDismiss} style={styles.dismiss}>
          <AppIcon name="close" color={theme.colors.ink} size={theme.sizes.icon} />
        </Pressable>
      </View>
      {entry.error ? <Text accessibilityRole="alert" style={styles.error}>{entry.error}</Text> : null}
      <AppButton
        label={entry.error ? 'Try again' : 'Undo'}
        accessibilityLabel={`${entry.error ? 'Try again to undo' : 'Undo'} removal of ${entry.item.name}`}
        loading={entry.restoring}
        testID={`remove.undo.${entry.item.id}`}
        variant="outline"
        onPress={onUndo}
      />
    </FadeIn>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    toast: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, borderColor: theme.colors.border, borderWidth: theme.sizes.borderHairline, padding: theme.spacing.md, gap: theme.spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    dismiss: { minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    label: { ...theme.type.body, color: theme.colors.ink, flex: 1 },
    error: { ...theme.type.meta, color: theme.colors.urgentInk },
  });
}
