import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import { SessionExpiredBanner } from '@/auth/session-expired-banner';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { type AppTheme, useTheme } from '@/theme';

const POINTS: { title: string; icon: IconName }[] = [
  { title: 'Snap your fridge or pantry', icon: 'camera-outline' },
  { title: 'Cook what expires first', icon: 'pot-steam-outline' },
  { title: 'See the food and money you save', icon: 'leaf' },
];

export function WelcomeScreen() {
  const theme = useTheme();
  const { sessionExpired } = useApi();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View accessibilityLabel="BiteDown" accessibilityRole="image" style={styles.brandMark}>
          <AppIcon name="leaf" color={theme.colors.lime} size={theme.sizes.brandGlyph} />
        </View>
        <Text style={styles.headline}>Use what you have. Share what you spare.</Text>
        {sessionExpired ? <SessionExpiredBanner /> : null}
        <View style={styles.points}>
          {POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <View style={styles.pointIcon}>
                <AppIcon name={point.icon} color={theme.colors.forest} />
              </View>
              <Text style={styles.pointText}>{point.title}</Text>
            </View>
          ))}
        </View>
        <View style={styles.actions}>
          <AppButton label="Sign up" onPress={() => router.push('/signup')} testID="welcome.signup.button" />
          <AppButton
            label="Log in"
            onPress={() => router.push('/login')}
            testID="welcome.login.button"
            variant="secondary"
          />
          <AppButton
            label="Debug settings"
            onPress={() => router.push('/debug')}
            testID="welcome.debug.button"
            variant="outline"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, gap: theme.spacing.xl, padding: theme.spacing.xl },
    brandMark: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: theme.colors.forest,
      borderRadius: theme.radii.hero,
      height: theme.sizes.brandMark,
      justifyContent: 'center',
      width: theme.sizes.brandMark,
    },
    headline: { ...theme.type.signInHeadline, color: theme.colors.ink },
    points: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.hero,
      gap: theme.spacing.md,
      padding: theme.spacing.lg,
    },
    point: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.tileInner },
    pointIcon: {
      alignItems: 'center',
      backgroundColor: theme.colors.limeTint,
      borderRadius: theme.radii.control,
      height: theme.sizes.touchTarget,
      justifyContent: 'center',
      width: theme.sizes.touchTarget,
    },
    pointText: { ...theme.type.cardHeading, color: theme.colors.ink, flex: 1 },
    actions: { gap: theme.spacing.md, marginTop: 'auto' },
  });
}
