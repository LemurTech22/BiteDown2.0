import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Storage } from '@/api/types';
import { STORAGE_OPTIONS } from '@/features/fridge/fridge-utils';
import { type AppTheme, useTheme } from '@/theme';

interface StorageSegmentedProps {
  value: Storage;
  onChange: (storage: Storage) => void;
}

export function StorageSegmented({ value, onChange }: StorageSegmentedProps) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Storage" style={styles.track}>
      {STORAGE_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={`${option.label} storage`}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            testID={`fridge.storage.${option.value}`}
            style={({ pressed }) => [styles.option, selected && styles.selected, pressed && styles.pressed]}>
            <Text style={[styles.label, selected && styles.selectedLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    track: {
      backgroundColor: theme.colors.track,
      borderRadius: theme.radii.control,
      flexDirection: 'row',
      gap: theme.spacing.xs,
      padding: theme.spacing.xs,
    },
    option: {
      alignItems: 'center',
      borderRadius: theme.radii.chip,
      flex: 1,
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      paddingHorizontal: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
    },
    selected: { backgroundColor: theme.colors.surface },
    label: { ...theme.type.bodySmall, color: theme.colors.muted, textAlign: 'center' },
    selectedLabel: { color: theme.colors.ink, fontWeight: '600' },
    pressed: { opacity: 0.7 },
  });
}
