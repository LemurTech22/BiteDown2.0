import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { type AppTheme, useTheme } from '@/theme';

export function ItemField({ label, testID, ...props }: TextInputProps & { label: string; testID: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} testID={testID} style={styles.input}
      selectionColor={theme.colors.forest} placeholderTextColor={theme.colors.muted} />
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    field: { gap: theme.spacing.sm }, label: { ...theme.type.formLabel, color: theme.colors.inkSecondary },
    input: { ...theme.type.bodyLarge, color: theme.colors.ink, backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.input, borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border,
      minHeight: theme.sizes.input, paddingHorizontal: theme.spacing.tileInner, paddingVertical: theme.spacing.md },
  });
}
