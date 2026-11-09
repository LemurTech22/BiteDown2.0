import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type AppTheme, useTheme } from '@/theme';

export function ChoiceControl<T extends string>({ label, options, value, onChange, testID, disabled = false }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
}) {
  const styles = createStyles(useTheme());
  return (
    <View style={styles.group} accessibilityLabel={label} testID={testID}>
      {options.map((option) => (
        <Pressable key={option.value} accessibilityRole="radio"
          accessibilityLabel={`${label}: ${option.label}`}
          accessibilityState={{ checked: value === option.value, disabled }} disabled={disabled}
          onPress={() => onChange(option.value)} testID={`${testID}.${option.value}`}
          style={[styles.option, value === option.value && styles.selected]}>
          <Text numberOfLines={1} style={[styles.label, value === option.value && styles.selectedLabel]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    group: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, flexShrink: 0 },
    option: { minWidth: theme.sizes.touchTarget,
      minHeight: theme.sizes.touchTarget, justifyContent: 'center', padding: theme.spacing.sm,
      backgroundColor: theme.colors.surface, borderRadius: theme.radii.control,
      borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border },
    selected: { backgroundColor: theme.colors.forest, borderColor: theme.colors.forest },
    label: { ...theme.type.bodySmall, color: theme.colors.forest, textAlign: 'center' },
    selectedLabel: { color: theme.colors.onForest },
  });
}
