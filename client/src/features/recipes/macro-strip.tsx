import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Recipe } from '@/api';
import { type AppTheme, useTheme } from '@/theme';

export function MacroStrip({ macros, onCard = false, testID }: { macros: Recipe['macros']; onCard?: boolean; testID: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const styles = createStyles(theme);
  if (!macros) return null;
  const cells = [
    { value: String(macros.kcal), label: 'kcal' },
    { value: macros.protein_g + ' g', label: 'protein' },
    { value: macros.carbs_g + ' g', label: 'carbs' },
    { value: macros.fat_g + ' g', label: 'fat' },
  ];
  return (
    <View accessibilityLabel="Macros estimated per serving" style={[styles.strip, onCard && styles.heroStrip]} testID={testID}>
      {cells.map((cell) => (
        <View key={cell.label} accessible accessibilityLabel={cell.value + ' ' + cell.label + ' per serving, estimated'}
          style={[styles.cell, fontScale > 1.3 && styles.largeCell, onCard && styles.heroCell]}>
          <Text style={[styles.value, onCard && styles.heroValue]}>{cell.value}</Text>
          <Text style={[styles.label, onCard && styles.heroLabel]}>{cell.label}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    strip: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xxs, borderRadius: theme.radii.control, overflow: 'hidden' },
    heroStrip: { backgroundColor: theme.colors.forestChip },
    cell: { flexGrow: 1, flexBasis: '23%', alignItems: 'center', backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.input },
    largeCell: { flexBasis: '46%' },
    heroCell: { backgroundColor: theme.colors.forest, borderRadius: 0 },
    value: { ...theme.type.cardHeading, color: theme.colors.ink },
    label: { ...theme.type.meta, color: theme.colors.muted },
    heroValue: { color: theme.colors.onForest },
    heroLabel: { color: theme.colors.onForestMuted },
  });
}
