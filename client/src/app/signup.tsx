import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthScreen } from '@/auth/auth-screen';

export default function SignUpRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Redirect href="/home" />;
  return <AuthScreen mode="signup" />;
}
