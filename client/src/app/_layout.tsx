import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api';
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
        <Stack.Screen name="debug" options={{ title: 'Debug settings' }} />
      </Stack>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ApiProvider>
        <RootStack />
      </ApiProvider>
    </SafeAreaProvider>
  );
}
