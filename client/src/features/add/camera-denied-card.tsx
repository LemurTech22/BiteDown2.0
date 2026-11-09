import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { useTheme } from '@/theme';

import { addStyles } from './add-screen';

export function CameraDeniedCard({ screen, onRetry }: { screen: string; onRetry: () => void }) {
  const theme = useTheme();
  const styles = addStyles(theme);
  const [error, setError] = useState('');
  return <View style={styles.card} testID={`${screen}.picker.error`}>
    <AppIcon name="camera-off" color={theme.colors.useSoonInk} />
    <Text accessibilityRole="alert" style={styles.heading}>Camera access is off</Text>
    <Text style={styles.body}>Turn it on in Settings to snap your fridge or scan barcodes.</Text>
    <AppButton label="Open Settings" testID={`${screen}.settings.button`}
      onPress={() => void Linking.openSettings().catch(() => setError('Open your device Settings to allow camera access.'))} />
    <AppButton label="Type it instead" testID={`${screen}.type.button`} variant="outline" onPress={() => router.push('/add-text')} />
    <AppButton label="Try again" testID={`${screen}.picker.retry`} variant="outline" onPress={onRetry} />
    {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
  </View>;
}
