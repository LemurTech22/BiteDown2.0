import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateView } from '@/components/ui/state-view';
import { type AppTheme, useTheme } from '@/theme';

export default function SocialScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <StateView
        icon="account-group-outline"
        message="Friends and groups are coming next."
        testID="social.empty.state"
        title="Social"
      />
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({ screen: { flex: 1, backgroundColor: theme.colors.ground } });
}
