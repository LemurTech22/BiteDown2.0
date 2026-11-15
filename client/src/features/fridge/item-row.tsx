import { router } from 'expo-router';
import { useState } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodGroup, Item } from '@/api/types';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
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
  const web = Platform.OS === 'web';
  const [actionsOpen, setActionsOpen] = useState(false);
  const groupColors = theme.foodGroups[item.food_group];
  const styles = createStyles(theme);
  const freshness = item.freshness === 'fresh' ? 'Fresh' : item.freshness === 'semi_fresh' ? 'Use soon' : item.freshness === 'spoiled' ? 'Looks off' : 'Not checked';
  const label = `View ${item.name}, ${quantityLabel(item, units)}, expiry ${item.predicted_expiry ?? 'unknown'}, freshness ${freshness}`;
  function move() { setActionsOpen(false); onMove(); }
  function remove() { setActionsOpen(false); onRemove(); }
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !web && !selecting && !disabled && Math.abs(gesture.dx) > theme.sizes.touchTarget && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      if (!web && !selecting && !disabled && Math.abs(gesture.dx) > Math.abs(gesture.dy)) {
        if (gesture.dx < -theme.sizes.touchTarget) setActionsOpen(true);
        else if (gesture.dx > theme.sizes.touchTarget) setActionsOpen(false);
      }
    },
  });
  return (
    <View {...swipe.panHandlers} style={[styles.row, !last && styles.divider]} testID={`fridge.item.${item.id}`}>
      {!selecting && !web ? <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${item.name} to another storage`}
          testID={`fridge.move.${item.id}`} disabled={disabled} onPress={move} style={styles.action}>
          <AppIcon name="swap-horizontal" color={theme.colors.forest} size={theme.sizes.icon} />
        </Pressable>
      </View> : null}
      <View style={[styles.foreground, selected && styles.selected, !selecting && actionsOpen && styles.revealed]}>
      {selecting ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.name}`} accessibilityState={{ checked: selected, disabled }}
        disabled={disabled} testID={`fridge.select.${item.id}`} onPress={onSelect} style={styles.checkTarget}>
        <View style={[styles.checkbox, selected && styles.checked]}>{selected ? <AppIcon name="check" color={theme.colors.onForest} size={theme.sizes.iconSmall} /> : null}</View>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} testID={`fridge.open.${item.id}`}
        accessibilityHint={selecting || web ? undefined : 'Swipe left for Move.'}
        accessibilityActions={selecting || disabled || web ? undefined : [{ name: 'move', label: `Move ${item.name} to another storage` }, { name: 'remove', label: `Remove ${item.name}` }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (selecting || disabled) return;
          if (nativeEvent.actionName === 'move') move();
          else if (nativeEvent.actionName === 'remove') remove();
        }}
        onPress={() => { setActionsOpen(false); if (onOpen) onOpen(); else router.push(`/item/${item.id}`); }} style={styles.main}>
      <View style={[styles.iconTile, { backgroundColor: groupColors.tile }]}>
        <AppIcon name={groupIcon(item.food_group)} color={groupColors.stroke} size={theme.sizes.icon} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>{quantityLabel(item, units)}</Text>
        <View style={styles.status}><ExpiryBadge item={item} testID={`fridge.status.${item.id}`} /></View>
      </View>
      </Pressable>
      </View>
      {!selecting && web ? <Pressable accessibilityRole="button" accessibilityLabel={`Move ${item.name} to another storage`}
        testID={`fridge.move.${item.id}`} disabled={disabled} onPress={move} style={styles.action}>
        <AppIcon name="swap-horizontal" color={theme.colors.forest} size={theme.sizes.icon} />
      </Pressable> : null}
      {!selecting ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}
        testID={`fridge.remove.${item.id}`} disabled={disabled} onPress={remove} style={styles.action}>
        <AppIcon name="check-circle-outline" color={theme.colors.forest} size={theme.sizes.icon} />
      </Pressable> : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    foreground: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      flexDirection: 'row',
      flex: 1,
      gap: theme.spacing.md,
      minHeight: theme.sizes.itemRow,
      minWidth: 0,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    actions: { position: 'absolute', right: theme.sizes.touchTarget, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' },
    action: { width: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    revealed: { transform: [{ translateX: -theme.sizes.touchTarget }] },
    divider: { borderBottomColor: theme.colors.hairline, borderBottomWidth: theme.sizes.borderHairline },
    main: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, gap: theme.spacing.md, minHeight: theme.sizes.touchTarget },
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
      flexShrink: 0,
    },
    copy: { flex: 1, gap: theme.spacing.xxs, minWidth: 0 },
    status: { alignSelf: 'flex-start', maxWidth: '100%' },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
  });
}
