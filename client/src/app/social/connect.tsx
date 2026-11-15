import { Stack } from 'expo-router';

import { ConnectScreen } from '@/features/connect/connect-screen';

export default function Route() {
  return <><Stack.Screen options={{ headerShown: false }} /><ConnectScreen /></>;
}
