import { Stack } from 'expo-router';

import { GroupDetailScreen } from '@/features/connect/group-detail-screen';

export default function Route() {
  return <><Stack.Screen options={{ headerShown: false }} /><GroupDetailScreen /></>;
}
