import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { useUndoToastTimeout } from '@/features/remove/use-undo-toast-timeout';
import { type AppTheme, useTheme } from '@/theme';

export interface BatchUndo { id: number; itemIds: string[]; outcome: 'used' | 'donated'; expiresAt: number; toastExpiresAt: number; pending: boolean; error: string }

export function BatchUndoToast({ entry, onUndo, onDismiss }: { entry: BatchUndo; onUndo: () => void; onDismiss: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { pause, resume } = useUndoToastTimeout(entry.toastExpiresAt, entry.pending || !!entry.error, onDismiss);
  const buttonInteractions = {
    onFocus: () => pause('focus'), onBlur: () => resume('focus'),
    onPressIn: () => pause('press'), onPressOut: () => resume('press'),
  };
  return <FadeIn style={styles.toast} testID={`fridge.batchToast.${entry.id}`}
    onPointerEnter={() => pause('hover')} onPointerLeave={() => resume('hover')}>
    <View style={styles.header}>
      <Text accessibilityLiveRegion="polite" style={styles.label}>{entry.itemIds.length} items marked {entry.outcome === 'used' ? 'used' : 'shared'}</Text>
      <Pressable {...buttonInteractions} accessibilityRole="button" accessibilityLabel="Dismiss" testID={`fridge.batchUndo.dismiss.${entry.id}`} onPress={onDismiss} style={styles.dismiss}>
        <AppIcon name="close" color={theme.colors.onForest} size={theme.sizes.icon} />
      </Pressable>
    </View>
    {entry.error ? <Text accessibilityRole="alert" style={styles.error}>{entry.error}</Text> : null}
    <AppButton {...buttonInteractions} label={entry.error ? 'Try again' : 'Undo'} testID={`fridge.batchUndo.${entry.id}`} variant="outline" loading={entry.pending} onPress={onUndo} />
  </FadeIn>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    toast: { borderRadius: theme.radii.control, backgroundColor: theme.colors.forest, padding: theme.spacing.md, gap: theme.spacing.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    dismiss: { minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    label: { ...theme.type.body, color: theme.colors.onForest, flex: 1 },
    error: { ...theme.type.bodySmall, color: theme.colors.onForest },
  });
}
