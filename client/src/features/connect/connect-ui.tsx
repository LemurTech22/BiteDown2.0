import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppIcon } from '@/components/ui/app-icon';
import { colors, type AppTheme, useTheme } from '@/theme';

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

export function Avatar({ name }: { name: string }) {
  const styles = connectStyles(useTheme());
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.avatar}>
    <Text style={styles.avatarText}>{initials(name)}</Text>
  </View>;
}

export function CodeQr({ value, label, group = false, testID }: {
  value: string; label: string; group?: boolean; testID: string;
}) {
  const theme = useTheme();
  return <View accessible accessibilityRole="image" accessibilityLabel={label} testID={testID}
    style={{ alignSelf: 'center', padding: theme.spacing.md, backgroundColor: theme.colors.lime }}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <QRCode value={value} size={group ? theme.sizes.groupQr : theme.sizes.friendQr}
        color={colors.light.ink} backgroundColor={theme.colors.lime} ecl="M" />
    </View>
  </View>;
}

export function Toggle({ label, expanded, onPress, testID }: {
  label: string; expanded: boolean; onPress: () => void; testID: string;
}) {
  const theme = useTheme();
  const styles = connectStyles(theme);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ expanded }} onPress={onPress} testID={testID} style={styles.toggle}>
    <Text style={styles.toggleText}>{label}</Text>
    <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} color={theme.colors.forest} />
  </Pressable>;
}

export function CodeField({ label, value, onChangeText, testID, editable = true, error }: {
  label: string; value: string; onChangeText: (text: string) => void; testID: string;
  editable?: boolean; error?: string | null;
}) {
  const theme = useTheme();
  const styles = connectStyles(theme);
  return <View style={styles.section}>
    <Text style={styles.meta}>{label}</Text>
    <TextInput accessibilityLabel={label} testID={testID} value={value} onChangeText={onChangeText}
      autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={256}
      editable={editable} style={[styles.input, !!error && styles.invalid]} selectionColor={theme.colors.forest} />
    {error ? <Text accessibilityRole="alert" testID={`${testID}.error`} style={styles.error}>{error}</Text> : null}
  </View>;
}

export function connectStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, padding: theme.spacing.gutter, gap: theme.spacing.xl, paddingBottom: theme.spacing.xxl },
    header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink, flex: 1 },
    heading: { ...theme.type.sectionHeading, color: theme.colors.ink },
    section: { gap: theme.spacing.sm },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.tileInner, gap: theme.spacing.md },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm },
    copy: { flexGrow: 1, flexShrink: 1, gap: theme.spacing.xs },
    name: { ...theme.type.rowTitle, color: theme.colors.ink, flexShrink: 1 },
    body: { ...theme.type.body, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    error: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
    avatar: { minHeight: theme.sizes.itemIcon, minWidth: theme.sizes.itemIcon, padding: theme.spacing.sm,
      backgroundColor: theme.colors.limeTint, borderRadius: theme.radii.round, alignItems: 'center', justifyContent: 'center' },
    avatarText: { ...theme.type.badge, color: theme.colors.forest },
    toggle: { minHeight: theme.sizes.touchTarget, padding: theme.spacing.tileInner, gap: theme.spacing.sm,
      flexDirection: 'row', alignItems: 'center', borderRadius: theme.radii.control,
      borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    toggleText: { ...theme.type.button, color: theme.colors.forest, flex: 1 },
    input: { ...theme.type.bodyLarge, color: theme.colors.ink, backgroundColor: theme.colors.surface,
      borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border, borderRadius: theme.radii.input,
      minHeight: theme.sizes.input, paddingHorizontal: theme.spacing.tileInner, paddingVertical: theme.spacing.sm },
    invalid: { borderColor: theme.colors.urgentInk, borderWidth: theme.sizes.focusRing },
  });
}
