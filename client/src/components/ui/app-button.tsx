import { ActivityIndicator, Pressable, type PressableProps, StyleSheet, Text } from 'react-native';

import { type AppTheme, useTheme } from '@/theme';

interface AppButtonProps extends Pick<PressableProps, 'onFocus' | 'onBlur' | 'onPressIn' | 'onPressOut'> {
  label: string;
  testID: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
}

export function AppButton({
  label,
  testID,
  onPress,
  accessibilityLabel,
  disabled = false,
  loading = false,
  variant = 'primary',
  ...interactionProps
}: AppButtonProps) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const unavailable = disabled || loading;

  return (
    <Pressable
      {...interactionProps}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        unavailable && styles.disabled,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? theme.colors.forest : theme.colors.onForest} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    button: {
      alignItems: 'center',
      borderRadius: theme.radii.control,
      justifyContent: 'center',
      minHeight: theme.sizes.primaryButton,
      paddingHorizontal: theme.spacing.gutter,
      paddingVertical: theme.spacing.sm,
    },
    primary: { backgroundColor: theme.colors.forest },
    secondary: { backgroundColor: theme.colors.forestMid },
    outline: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: theme.sizes.borderHairline,
    },
    label: { ...theme.type.button, textAlign: 'center' },
    primaryLabel: { color: theme.colors.onForest },
    secondaryLabel: { color: theme.colors.onForest },
    outlineLabel: { color: theme.colors.forest },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.55 },
  });
}
