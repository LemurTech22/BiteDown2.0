import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateView } from '@/components/ui/state-view';
import { type AppTheme, useTheme } from '@/theme';

export default function FridgeRoute() {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <StateView
        icon="fridge-outline"
        message="Your food will appear here."
        testID="fridge.empty.state"
        title="Your food"
      />
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({ screen: { flex: 1, backgroundColor: theme.colors.ground } });
}
