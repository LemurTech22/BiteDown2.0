import { StyleSheet, Text, View } from 'react-native';

import type { Freshness } from '@/api/types';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { type AppTheme, useTheme } from '@/theme';

const PRESENTATION: Record<Freshness, { label: string; icon: IconName }> = {
  fresh: { label: 'Fresh', icon: 'check-circle-outline' },
  semi_fresh: { label: 'Use soon', icon: 'clock-alert-outline' },
  spoiled: { label: 'Spoiled', icon: 'alert-circle-outline' },
};

export function FreshnessBadge({ freshness, itemId }: { freshness: Freshness | null; itemId: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  if (!freshness) return null;
  const { label, icon } = PRESENTATION[freshness];
  return (
    <View
      accessible
      accessibilityLabel={`Freshness: ${label}`}
      style={[styles.badge, styles[freshness]]}
      testID={`fridge.status.${itemId}`}>
      <AppIcon
        name={icon}
        color={freshness === 'spoiled' ? theme.colors.urgentInk : freshness === 'semi_fresh' ? theme.colors.useSoonInk : theme.colors.forest}
        size={theme.sizes.iconSmall}
      />
      <Text style={[styles.label, styles[`${freshness}Label`]]}>{label}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    badge: {
      alignItems: 'center',
      alignSelf: 'center',
      borderRadius: theme.radii.chip,
      flexDirection: 'row',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    fresh: { backgroundColor: theme.colors.limeTint },
    semi_fresh: { backgroundColor: theme.colors.useSoonBg },
    spoiled: { backgroundColor: theme.colors.urgentBg },
    label: { ...theme.type.badge },
    freshLabel: { color: theme.colors.forest },
    semi_freshLabel: { color: theme.colors.useSoonInk },
    spoiledLabel: { color: theme.colors.urgentInk },
  });
}
