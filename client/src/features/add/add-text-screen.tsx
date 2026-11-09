import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function AddTextScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ground }}>
      <Text testID="addText.placeholder" accessibilityRole="header" style={{ ...theme.type.screenTitle, color: theme.colors.ink }}>
        Type or say it
      </Text>
    </View>
  );
}
