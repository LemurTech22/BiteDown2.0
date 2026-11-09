import { Pressable, StyleSheet } from 'react-native';

import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { type AppTheme, useTheme } from '@/theme';

interface IconButtonProps {
  icon: IconName;
  label: string;
  testID: string;
  onPress: () => void;
}

export function IconButton({ icon, label, testID, onPress }: IconButtonProps) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={theme.spacing.xs}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <AppIcon name={icon} color={theme.colors.forest} size={theme.sizes.icon} />
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    button: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.round,
      borderWidth: theme.sizes.borderHairline,
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      minWidth: theme.sizes.touchTarget,
    },
    pressed: { opacity: 0.7 },
  });
}
