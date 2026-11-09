import { Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api';
import { AuthProvider } from '@/auth/auth-provider';
import { useTheme } from '@/theme';

function RootStack() {
  const theme = useTheme();
  return (
    <>
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
        <Stack.Screen name="debug" options={{ title: 'Debug settings' }} />
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
          <RootStack />
        </AuthProvider>
      </ApiProvider>
    </SafeAreaProvider>
  );
}
