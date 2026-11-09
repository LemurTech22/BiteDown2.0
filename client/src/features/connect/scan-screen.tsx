import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function ScanScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ground }}>
      <Text testID="friendScan.placeholder" accessibilityRole="header" style={{ ...theme.type.screenTitle, color: theme.colors.ink }}>
        Scan a friend’s code
      </Text>
    </View>
  );
}
