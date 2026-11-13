import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { ServerSettingsLink } from '@/auth/server-settings-link';
import { WelcomeScreen } from '@/auth/welcome-screen';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { type AppTheme, useTheme } from '@/theme';

export default function IndexRoute() {
  const theme = useTheme();
  const { error, retry, status } = useAuth();
  const styles = createStyles(theme);

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <SkeletonRows testID="auth.loading.skeleton" />
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.errorContent}>
          <View>
            <StateView
              actionLabel="Try again"
              actionTestID="auth.error.retry"
              icon="cloud-off-outline"
              message={error ?? 'We couldn’t restore your session. Try again.'}
              onAction={() => void retry()}
              testID="auth.error.state"
              title="Can’t reach BiteDown"
            />
            <ServerSettingsLink />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (status === 'authenticated') return <Redirect href="/home" />;
  return <WelcomeScreen />;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground, padding: theme.spacing.gutter },
    errorContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  });
}
