import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { type AppTheme, useTheme } from '@/theme';

export function ServerSettingsLink() {
  const styles = createStyles(useTheme());
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Server settings"
      onPress={() => router.push('/debug')}
      style={styles.link}
      testID="auth.server-settings.link">
      <Text style={styles.text}>Server settings</Text>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    link: {
      alignSelf: 'center',
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      paddingHorizontal: theme.spacing.xs,
    },
    text: { ...theme.type.bodySmall, color: theme.colors.forest },
  });
}
