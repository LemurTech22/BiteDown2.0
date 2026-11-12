import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';

export default function GroupRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'error') return <Redirect href="/" />;
  if (status !== 'authenticated') return <Redirect href={{ pathname: '/login', params: { next: `/social/connect?invite=${encodeURIComponent(code)}` } }} />;

  return <Redirect href={{ pathname: '/social/connect', params: { invite: code } }} />;
}
