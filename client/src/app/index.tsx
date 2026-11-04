import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import { SessionExpiredBanner } from '@/auth/session-expired-banner';
import { type AppTheme, useTheme } from '@/theme';

export default function HomeScreen() {
  const theme = useTheme();
  const { baseUrl, demoMode, sessionExpired } = useApi();
  const styles = createStyles(theme);

  return (
    <SafeAreaView style={styles.screen} testID="home.placeholder">
      <View style={styles.content}>
        <Text style={styles.title}>BiteDown</Text>
        <Text style={styles.tagline}>Use what you have. Share what you spare.</Text>
        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>{demoMode ? 'Demo mode' : 'Live API'}</Text>
          <Text style={styles.statusMeta}>{demoMode ? 'In-memory mock data' : baseUrl}</Text>
        </View>
        {sessionExpired ? <SessionExpiredBanner /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open debug settings"
          testID="home.debug.button"
          onPress={() => router.push('/debug')}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>Debug settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: {
      flex: 1,
      justifyContent: 'center',
      gap: theme.spacing.xl,
      padding: theme.spacing.gutter,
    },
    title: {
      ...theme.type.screenTitle,
      fontFamily: theme.type.body.fontFamily,
      color: theme.colors.forest,
      textAlign: 'center',
    },
    tagline: { ...theme.type.bodyLarge, color: theme.colors.inkSecondary, textAlign: 'center' },
    statusCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
      gap: theme.spacing.xs,
      padding: theme.spacing.gutter,
    },
    statusTitle: { ...theme.type.cardHeading, color: theme.colors.ink },
    statusMeta: { ...theme.type.meta, color: theme.colors.muted },
    button: {
      alignItems: 'center',
      backgroundColor: theme.colors.forest,
      borderRadius: theme.radii.control,
      justifyContent: 'center',
      minHeight: theme.sizes.primaryButton,
      paddingHorizontal: theme.spacing.gutter,
    },
    buttonText: { ...theme.type.button, color: theme.colors.onForest },
    pressed: { opacity: 0.85 },
  });
}
