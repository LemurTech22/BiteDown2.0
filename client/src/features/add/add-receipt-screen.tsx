import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function AddReceiptScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ground }}>
      <Text testID="addReceipt.placeholder" accessibilityRole="header" style={{ ...theme.type.screenTitle, color: theme.colors.ink }}>
        Receipt review
      </Text>
    </View>
  );
}
