import { StyleSheet, Text, View } from 'react-native';

import type { FoodGroup, Item } from '@/api/types';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { FreshnessBadge } from '@/features/fridge/freshness-badge';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { type AppTheme, useTheme } from '@/theme';

const GROUP_ICONS: Record<FoodGroup, IconName> = {
  protein: 'food-drumstick-outline',
  veggies: 'carrot',
  fruit: 'food-apple-outline',
  dairy: 'cup-outline',
  grains: 'bread-slice-outline',
  pantry: 'package-variant-closed',
  leftovers: 'food-takeout-box-outline',
  frozen: 'snowflake',
  other: 'dots-horizontal-circle-outline',
};

export function groupIcon(foodGroup: FoodGroup): IconName {
  return GROUP_ICONS[foodGroup];
}

export function ItemRow({ item, last, onRemove }: { item: Item; last: boolean; onRemove: () => void }) {
  const theme = useTheme();
  const groupColors = theme.foodGroups[item.food_group];
  const styles = createStyles(theme);
  return (
    <View style={[styles.row, !last && styles.divider]} testID={`fridge.item.${item.id}`}>
      <View style={[styles.iconTile, { backgroundColor: groupColors.tile }]}>
        <AppIcon name={groupIcon(item.food_group)} color={groupColors.stroke} size={theme.sizes.icon} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>{quantityLabel(item)}</Text>
      </View>
      <FreshnessBadge freshness={item.freshness} itemId={item.id} />
      <IconButton
        icon="tray-arrow-up"
        label={`Remove ${item.name}`}
        testID={`fridge.remove.${item.id}`}
        onPress={onRemove}
      />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      minHeight: theme.sizes.itemRow,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    divider: { borderBottomColor: theme.colors.hairline, borderBottomWidth: theme.sizes.borderHairline },
    iconTile: {
      alignItems: 'center',
      borderRadius: theme.radii.input,
      height: theme.sizes.itemIcon,
      justifyContent: 'center',
      width: theme.sizes.itemIcon,
    },
    copy: { flexGrow: 1, flexShrink: 1, gap: theme.spacing.xxs, minWidth: '50%' },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
  });
}
