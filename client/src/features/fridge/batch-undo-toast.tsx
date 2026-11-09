import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

export interface BatchUndo { id: number; itemIds: string[]; outcome: 'used' | 'donated'; expiresAt: number; pending: boolean; error: string }

export function BatchUndoToast({ entry, onUndo, onExpire }: { entry: BatchUndo; onUndo: () => void; onExpire: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const [remaining, setRemaining] = useState(1);
  useEffect(() => {
    const refresh = () => {
      const left = entry.expiresAt - Date.now();
      if (left <= 0 && !entry.pending && !entry.error) onExpire();
      setRemaining(Math.max(0, left / 5000));
    };
    const expiry = setTimeout(refresh, Math.max(0, entry.expiresAt - Date.now()));
    const timer = reducedMotion ? null : setInterval(refresh, theme.motion.quickMs);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearTimeout(expiry); if (timer) clearInterval(timer); subscription.remove(); };
  }, [entry.expiresAt, entry.pending, entry.error, onExpire, reducedMotion, theme.motion.quickMs]);
  return <View style={styles.toast} testID={`fridge.batchToast.${entry.id}`}>
    <Text accessibilityLiveRegion="polite" style={styles.label}>{entry.itemIds.length} items marked {entry.outcome === 'used' ? 'used' : 'shared'}</Text>
    {entry.error ? <Text accessibilityRole="alert" style={styles.error}>{entry.error}</Text> : null}
    <AppButton label={entry.error ? 'Try again' : 'Undo'} testID={`fridge.batchUndo.${entry.id}`} variant="outline" loading={entry.pending} onPress={onUndo} />
    <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.progress, { width: `${reducedMotion ? 100 : Math.min(100, remaining * 100)}%` }]} /></View>
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    toast: { borderRadius: theme.radii.control, backgroundColor: theme.colors.forest, padding: theme.spacing.md, gap: theme.spacing.sm },
    label: { ...theme.type.body, color: theme.colors.onForest }, error: { ...theme.type.bodySmall, color: theme.colors.onForest },
    track: { height: theme.sizes.progressStrip, backgroundColor: theme.colors.forestMid }, progress: { height: theme.sizes.progressStrip, backgroundColor: theme.colors.onForest },
  });
}
