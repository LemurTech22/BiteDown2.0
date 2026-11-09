import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/auth-provider';
import { AppButton } from '@/components/ui/app-button';
import { type AppTheme, useTheme } from '@/theme';

export default function HomeScreen() {
  const theme = useTheme();
  const { signOut, user } = useAuth();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content} testID="home.empty.state">
        <Text style={styles.title}>Home</Text>
        <Text style={styles.message}>Welcome{user?.display_name ? `, ${user.display_name}` : ''}.</Text>
        <AppButton label="Sign out" onPress={() => void signOut()} testID="home.signout.button" variant="outline" />
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flex: 1, gap: theme.spacing.lg, justifyContent: 'center', padding: theme.spacing.gutter },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    message: { ...theme.type.bodyLarge, color: theme.colors.muted },
  });
}
