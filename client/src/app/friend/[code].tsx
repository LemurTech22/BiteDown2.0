import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';

export default function FriendRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'error') return <Redirect href="/" />;
  if (status !== 'authenticated') return <Redirect href="/login" />;

  return <Redirect href={{ pathname: '/social/scan', params: { code } }} />;
}
