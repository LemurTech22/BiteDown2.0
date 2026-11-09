import { StyleSheet, Text, View } from 'react-native';

import type { Item } from '@/api';
import { type AppTheme, useTheme } from '@/theme';

export function expiryLabel(item: Item, now = new Date()): string | null {
  if (item.freshness === 'spoiled') return 'Looks off';
  if (item.freshness === 'semi_fresh') return 'Use soon';
  if (!item.predicted_expiry) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((Date.parse(`${item.predicted_expiry}T00:00:00Z`) - today) / 86400000);
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (item.expiry_source === 'user') return `${days} days`;
  if (days <= 7) return `${days - 1}–${days} days`;
  if (days <= 14) return '1–2 weeks';
  if (days <= 21) return '2–3 weeks';
  return '3+ weeks';
}

export function ExpiryBadge({ item, testID }: { item: Item; testID: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const label = expiryLabel(item);
  if (!label) return null;
  const urgent = ['Today', 'Tomorrow', 'Expired', 'Looks off'].includes(label);
  const soon = label === 'Use soon';
  return <View style={[styles.badge, urgent && styles.urgent, soon && styles.soon]} testID={testID}>
    <Text accessibilityLabel={`Status: ${label}`} style={[styles.label, urgent && styles.urgentLabel, soon && styles.soonLabel]}>{label}</Text>
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    badge: { alignSelf: 'center', borderRadius: theme.radii.chip, backgroundColor: theme.colors.limeTint,
      paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
    urgent: { backgroundColor: theme.colors.urgentBg }, soon: { backgroundColor: theme.colors.useSoonBg },
    label: { ...theme.type.badge, color: theme.colors.forest }, urgentLabel: { color: theme.colors.urgentInk }, soonLabel: { color: theme.colors.useSoonInk },
  });
}
