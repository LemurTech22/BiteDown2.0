import { Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api';
import { AuthProvider } from '@/auth/auth-provider';
import { GlobalBanners } from '@/components/global-banners';
import { PreferencesProvider } from '@/settings/preferences';
import { useTheme } from '@/theme';

function RootStack() {
  const theme = useTheme();
  return (
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-modal" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="debug" options={{ title: 'Debug settings' }} />
        <Stack.Screen name="item/[id]" options={{ title: "Item detail", headerShown: false }} />
        <Stack.Screen name="add-text" options={{ title: "Type or say it", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-barcode" options={{ title: "Scan a barcode", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="add-receipt" options={{ title: "Receipt review", presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="recipes/index" options={{ title: "Recipes", headerShown: false }} />
        <Stack.Screen name="recipes/[id]" options={{ title: "Recipe detail", headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: "Profile & settings", headerShown: false }} />
        <Stack.Screen name="social/pantry" options={{ title: "Food Pantry", headerShown: false }} />
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
            <RootStack />
          </PreferencesProvider>
        </AuthProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
