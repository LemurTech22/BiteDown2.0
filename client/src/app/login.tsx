import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthScreen } from '@/auth/auth-screen';

export default function LogInRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Redirect href="/home" />;
  return <AuthScreen mode="login" />;
}
