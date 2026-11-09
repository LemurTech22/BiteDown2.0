import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import { clearServerError, reportServerError, useServerError } from '@/components/server-error';
import { getServerErrorRevision } from '@/components/server-error/store';
import { AppButton } from '@/components/ui/app-button';
import { type AppTheme, useTheme } from '@/theme';

export function GlobalBanners() {
  const visible = useServerError();
  const { api, baseUrl } = useApi();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const pending = useRef(false);

  async function retry() {
    if (pending.current) return;
    pending.current = true;
    setRetrying(true);
    setRetryFailed(false);
    const revision = getServerErrorRevision();
    try {
      await api.health();
      // A newer failure must survive a health check that started before it.
      if (revision === getServerErrorRevision()) clearServerError();
    } catch (error) {
      reportServerError(error);
      setRetryFailed(true);
    } finally {
      pending.current = false;
      setRetrying(false);
    }
  }

  if (!visible) return null;
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea} testID="serverError.banner.container">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.banner}>
        <View accessibilityLiveRegion="polite" style={styles.copy}>
          <Text accessibilityRole="alert" style={styles.title}>{"Can't reach BiteDown"}</Text>
          <Text style={styles.message}>Check your connection.</Text>
          {retryFailed ? <Text accessibilityRole="alert" style={styles.message}>{"Still can't reach BiteDown. Try again."}</Text> : null}
        </View>
        <View style={styles.actions}>
          <AppButton label="Try again" loading={retrying} testID="serverError.banner.retry" onPress={() => void retry()} />
          <AppButton label="Server address" accessibilityLabel={`Server address: ${baseUrl}. Change server address`}
            testID="serverError.banner.address" variant="outline" onPress={() => router.push('/debug')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safeArea: { backgroundColor: theme.colors.ground, maxHeight: '50%' },
    scroll: { flexGrow: 0 },
    banner: { backgroundColor: theme.colors.useSoonBg, borderRadius: theme.radii.row,
      margin: theme.spacing.sm, padding: theme.spacing.tileInner, gap: theme.spacing.sm },
    copy: { gap: theme.spacing.xxs },
    title: { ...theme.type.rowTitle, color: theme.colors.useSoonInk },
    message: { ...theme.type.bodySmall, color: theme.colors.useSoonInk },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  });
}
