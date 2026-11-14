import { Text, View } from 'react-native';

import type { Item } from '@/api';
import { connectStyles } from '@/features/connect/connect-ui';
import { FOOD_GROUPS } from '@/features/fridge/fridge-utils';
import { ItemThumb } from '@/components/ui/item-thumb';
import { useTheme } from '@/theme';

export function expiryLabel(item: Item, now = new Date()) {
  if (item.freshness === 'spoiled') return 'Looks off';
  if (item.freshness === 'semi_fresh') return 'Use soon';
  if (!item.predicted_expiry) return null;
  const [year, month, day] = item.predicted_expiry.slice(0, 10).split('-').map(Number);
  const days = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (item.expiry_source === 'user') return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (days <= 7) return `${days % 2 === 0 ? days : days - 1}–${days % 2 === 0 ? days + 1 : days} days`;
  if (days <= 14) return '1–2 weeks';
  if (days <= 21) return '2–3 weeks';
  return '3+ weeks';
}

export function GroupPantryRow({ item, currentUserId }: { item: Item; currentUserId?: string }) {
  const theme = useTheme();
  const styles = connectStyles(theme);
  const badge = expiryLabel(item);
  const urgent = badge === 'Looks off' || badge === 'Expired' || badge === 'Today' || badge === 'Tomorrow';
  const soon = badge === 'Use soon';
  const ink = urgent ? theme.colors.urgentInk : soon ? theme.colors.useSoonInk : theme.colors.forest;
  const backgroundColor = urgent ? theme.colors.urgentBg : soon ? theme.colors.useSoonBg : theme.colors.limeTint;
  return <View style={[styles.card, styles.row]} testID={`groupDetail.item.${item.id}`}>
    <ItemThumb name={item.name} foodGroup={item.food_group} photoUrl={item.photo_url} />
    <View style={styles.copy}>
      <Text style={styles.name}>{item.name}</Text>
      <Text style={styles.meta}>Added by {item.owner_id === currentUserId ? 'you' : item.added_by ?? 'a member'} · {FOOD_GROUPS.find((group) => group.value === item.food_group)?.label}</Text>
    </View>
    {badge ? <View style={{ backgroundColor, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.radii.chip }}>
      <Text style={[theme.type.badge, { color: ink }]}>{badge}</Text>
    </View> : null}
  </View>;
}
