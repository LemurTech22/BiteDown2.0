import { Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api';
import { AuthProvider } from '@/auth/auth-provider';
import { GlobalBanners } from '@/components/global-banners';
import { NoticeProvider } from '@/components/notice/notice';
import { PreferencesProvider } from '@/settings/preferences';
import { useTheme } from '@/theme';

function RootStack() {
  const theme = useTheme();
  const content = (
    <>
      <GlobalBanners />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.ink,
          contentStyle: { backgroundColor: theme.colors.ground },
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="friend/[code]" options={{ headerShown: false }} />
        <Stack.Screen name="group/[code]" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-modal" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="removed" options={{ title: 'Recently removed' }} />
        <Stack.Screen name="debug" options={{ title: 'Server settings' }} />
        <Stack.Screen name="item/[id]" options={{ title: "Item detail", headerShown: false }} />
        <Stack.Screen name="add-text" options={{ title: "Type or say it", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-barcode" options={{ title: "Scan a barcode", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-receipt" options={{ title: "Receipt review", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="recipes/index" options={{ title: "Recipes", headerShown: false }} />
        <Stack.Screen name="recipes/[id]" options={{ title: "Recipe detail", headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Profile & settings", headerShown: false }} />
        <Stack.Screen name="social/pantry" options={{ title: "Shared food", headerShown: false }} />
        <Stack.Screen name="social/request-new" options={{ title: "Ask for something", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="social/my-requests" options={{ title: "Your requests", headerShown: false }} />
        <Stack.Screen name="social/claimed/[id]" options={{ title: "Claimed item", headerShown: false }} />
        <Stack.Screen name="social/connect" options={{ title: "Friends & groups", headerShown: false }} />
        <Stack.Screen name="social/scan" options={{ title: "Scan a friend's code", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="social/group/[id]" options={{ title: "Group", headerShown: false }} />
      </Stack>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
    </>
  );

  if (Platform.OS !== 'web') return content;
  return (
    <View style={{ flex: 1, height: '100%', alignItems: 'center', backgroundColor: theme.colors.surface }}>
      <View style={{ flex: 1, width: '100%', maxWidth: theme.sizes.webMaxContentWidth, backgroundColor: theme.colors.ground }}>
        {content}
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts([
    {
      fontFamily: 'Outfit',
      fontDefinitions: [
        { path: Outfit_500Medium, weight: 500 },
        { path: Outfit_600SemiBold, weight: 600 },
      ],
    },
  ]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ApiProvider>
        <AuthProvider>
          <PreferencesProvider>
            <NoticeProvider>
              <RootStack />
            </NoticeProvider>
          </PreferencesProvider>
        </AuthProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
