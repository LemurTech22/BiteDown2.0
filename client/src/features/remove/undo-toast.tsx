import { StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { FadeIn } from '@/components/ui/fade-in';
import type { UndoEntry } from '@/features/remove/use-removal-undo';
import { type AppTheme, useTheme } from '@/theme';

export function UndoToast({ entry, onUndo }: { entry: UndoEntry; onUndo: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <FadeIn style={styles.toast} testID={`remove.toast.${entry.item.id}`}>
      <Text accessibilityLiveRegion="polite" style={styles.label}>{entry.item.name} removed</Text>
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
    label: { ...theme.type.body, color: theme.colors.ink },
    error: { ...theme.type.meta, color: theme.colors.urgentInk },
  });
}
