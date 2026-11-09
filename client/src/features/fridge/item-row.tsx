import { router } from 'expo-router';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodGroup, Item } from '@/api/types';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { ExpiryBadge } from '@/features/fridge/expiry-badge';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { type AppTheme, useTheme } from '@/theme';
import type { Units } from '@/settings/preferences';

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

export function ItemRow({ item, last, onRemove, onMove, selecting = false, selected = false, onSelect, disabled = false, units = 'us', onOpen }: {
  item: Item; last: boolean; onRemove: () => void; onMove: () => void;
  selecting?: boolean; selected?: boolean; onSelect?: () => void; disabled?: boolean;
  units?: Units; onOpen?: () => void;
}) {
  const theme = useTheme();
  const groupColors = theme.foodGroups[item.food_group];
  const styles = createStyles(theme);
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !selecting && !disabled && gesture.dx < -theme.sizes.touchTarget && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => { if (!selecting && !disabled && gesture.dx < -theme.sizes.touchTarget) onRemove(); },
  });
  return (
    <View {...swipe.panHandlers} style={[styles.row, !last && styles.divider, selected && styles.selected]} testID={`fridge.item.${item.id}`}>
      {selecting ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.name}`} accessibilityState={{ checked: selected, disabled }}
        disabled={disabled} testID={`fridge.select.${item.id}`} onPress={onSelect} style={styles.checkTarget}>
        <View style={[styles.checkbox, selected && styles.checked]}>{selected ? <AppIcon name="check" color={theme.colors.onForest} size={theme.sizes.iconSmall} /> : null}</View>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.name}`} disabled={disabled} testID={`fridge.open.${item.id}`}
        onPress={() => { if (onOpen) onOpen(); else router.push(`/item/${item.id}`); }} style={styles.main}>
      <View style={[styles.iconTile, { backgroundColor: groupColors.tile }]}>
        <AppIcon name={groupIcon(item.food_group)} color={groupColors.stroke} size={theme.sizes.icon} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>{quantityLabel(item, units)}</Text>
      </View>
      <ExpiryBadge item={item} testID={`fridge.status.${item.id}`} />
      </Pressable>
      {!selecting ? <><AppButton label="Move to…" accessibilityLabel={`Move ${item.name} to another storage`}
        testID={`fridge.move.${item.id}`} onPress={onMove} variant="outline" />
      <IconButton
        icon="tray-arrow-up"
        label={`Remove ${item.name}`}
        testID={`fridge.remove.${item.id}`}
        onPress={onRemove}
      />
      </> : null}
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
    main: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, flexShrink: 1, flexBasis: '70%', gap: theme.spacing.md, minHeight: theme.sizes.touchTarget },
    selected: { backgroundColor: theme.colors.limeTint },
    checkTarget: { minHeight: theme.sizes.touchTarget, minWidth: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    checkbox: { width: theme.sizes.iconLarge, height: theme.sizes.iconLarge, borderRadius: theme.radii.round, borderWidth: theme.sizes.focusRing, borderColor: theme.colors.muted, alignItems: 'center', justifyContent: 'center' },
    checked: { backgroundColor: theme.colors.forest, borderColor: theme.colors.forest },
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
