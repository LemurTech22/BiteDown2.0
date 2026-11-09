import { Text, View } from 'react-native';

import { useTheme } from '@/theme';

export function RecipeDetailScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.ground }}>
      <Text testID="recipeDetail.placeholder" accessibilityRole="header" style={{ ...theme.type.screenTitle, color: theme.colors.ink }}>
        Recipe detail
      </Text>
    </View>
  );
}
