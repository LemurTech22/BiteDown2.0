import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/auth/auth-provider';
import { AuthScreen } from '@/auth/auth-screen';
import { socialNext } from '@/auth/social-next';

export default function SignUpRoute() {
  const { next } = useLocalSearchParams<{ next?: string | string[] }>();
  const { status } = useAuth();
  if (status === 'authenticated') return <Redirect href={socialNext(next) ?? '/home'} />;
  return <AuthScreen mode="signup" next={next} />;
}
