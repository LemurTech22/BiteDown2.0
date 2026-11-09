import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function MyRequestsScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ground }}>
      <Text testID="myRequests.placeholder" accessibilityRole="header" style={{ ...theme.type.screenTitle, color: theme.colors.ink }}>
        Your requests
      </Text>
    </View>
  );
}
