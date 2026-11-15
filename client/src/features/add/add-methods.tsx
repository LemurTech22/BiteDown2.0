import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { type AppTheme, useTheme } from '@/theme';

const methods: { id: string; label: string; hint: string; icon: IconName; route: Href }[] = [
  { id: 'text', label: 'Type it', hint: '"2 lb chicken, milk"', icon: 'keyboard-outline', route: '/add-text' },
  { id: 'voice', label: 'Say it', hint: '"Two lemons and some milk"', icon: 'microphone-outline', route: '/add-text?mode=voice' },
  { id: 'barcode', label: 'Barcode', hint: 'Boxes, cans, jars', icon: 'barcode-scan', route: '/add-barcode' },
  { id: 'receipt', label: 'Receipt', hint: 'Add a whole shop', icon: 'receipt', route: '/add-receipt' },
];

export function AddMethods() {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <View style={styles.grid}>
    {methods.map((method) => <Pressable key={method.id} accessibilityRole="button" accessibilityLabel={method.label}
      testID={`add.method.${method.id}`} style={styles.tile} onPress={() => router.push(method.route)}>
      <View style={styles.icon}><AppIcon name={method.icon} color={theme.colors.forest} /></View>
      <Text style={styles.title}>{method.label}</Text>
      <Text style={styles.hint}>{method.hint}</Text>
    </Pressable>)}
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.tileGap },
    tile: { flexGrow: 1, flexBasis: '45%', minHeight: theme.sizes.addHero + theme.spacing.xl, padding: theme.spacing.tileInner,
      borderRadius: theme.radii.optionTile, backgroundColor: theme.colors.surface,
      borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border, gap: theme.spacing.sm },
    icon: { alignSelf: 'flex-start', backgroundColor: theme.colors.limeTint, borderRadius: theme.radii.input, padding: theme.spacing.sm },
    title: { ...theme.type.cardHeading, color: theme.colors.ink },
    hint: { ...theme.type.meta, color: theme.colors.muted },
  });
}
