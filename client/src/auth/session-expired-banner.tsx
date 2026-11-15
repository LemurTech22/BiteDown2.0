import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function SessionExpiredBanner() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel="You were signed out. Log in again to pick up where you left off."
      testID="welcome.session.expired"
      style={{
        backgroundColor: theme.colors.urgentBg,
        borderRadius: theme.radii.control,
        padding: theme.spacing.lg,
      }}>
      <Text style={{ ...theme.type.body, color: theme.colors.urgentInk }}>
        You were signed out. Log in again to pick up where you left off.
      </Text>
    </View>
  );
}
