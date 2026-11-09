import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateView } from '@/components/ui/state-view';
import { type AppTheme, useTheme } from '@/theme';

export default function ImpactScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <StateView
        icon="leaf"
        message="Your food-saving impact will appear here."
        testID="impact.empty.state"
        title="Impact"
      />
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({ screen: { flex: 1, backgroundColor: theme.colors.ground } });
}
