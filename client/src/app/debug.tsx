import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_API_BASE_URL, useApi } from '@/api';
import { type AppTheme, useTheme } from '@/theme';

export default function DebugSettingsScreen() {
  const theme = useTheme();
  const { baseUrl, demoMode, setBaseUrl, setDemoMode } = useApi();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const styles = createStyles(theme);

  async function saveServerAddress() {
    setSaving(true);
    setMessage('');
    try {
      await setBaseUrl(draft ?? baseUrl);
      setDraft(null);
      setMessage('Server address saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Enter a valid server address.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.label}>Server address</Text>
          <TextInput
            accessibilityLabel="Server address"
            testID="settings.server.input"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setDraft}
            placeholder="https://api.example.com"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            value={draft ?? baseUrl}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save server address"
            testID="settings.server.save"
            disabled={saving}
            onPress={() => void saveServerAddress()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save server address'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset server address to default"
            testID="settings.server.reset"
            onPress={() => setDraft(DEFAULT_API_BASE_URL)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Reset to default</Text>
          </Pressable>
          {message ? (
            <Text accessibilityRole="alert" style={styles.message}>
              {message}
            </Text>
          ) : null}
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.label}>Demo mode</Text>
            <Text style={styles.meta}>Use in-memory data. No API or Gemini calls.</Text>
          </View>
          <Switch
            accessibilityLabel="Demo mode"
            testID="settings.demo.switch"
            onValueChange={(value) => void setDemoMode(value)}
            thumbColor={theme.colors.surface}
            trackColor={{ false: theme.colors.track, true: theme.colors.forest }}
            value={demoMode}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { gap: theme.spacing.xl, padding: theme.spacing.gutter },
    section: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
      gap: theme.spacing.md,
      padding: theme.spacing.lg,
    },
    label: { ...theme.type.rowTitle, color: theme.colors.ink },
    input: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.input,
      borderWidth: theme.sizes.borderHairline,
      color: theme.colors.ink,
      minHeight: theme.sizes.input,
      paddingHorizontal: theme.spacing.tileInner,
      ...theme.type.body,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.forest,
      borderRadius: theme.radii.control,
      justifyContent: 'center',
      minHeight: theme.sizes.primaryButton,
      paddingHorizontal: theme.spacing.gutter,
    },
    primaryButtonText: { ...theme.type.button, color: theme.colors.onForest },
    secondaryButton: {
      alignItems: 'center',
      borderColor: theme.colors.border,
      borderRadius: theme.radii.control,
      borderWidth: theme.sizes.borderHairline,
      justifyContent: 'center',
      minHeight: theme.sizes.touchTarget,
      paddingHorizontal: theme.spacing.gutter,
    },
    secondaryButtonText: { ...theme.type.body, color: theme.colors.forest },
    message: { ...theme.type.body, color: theme.colors.urgentInk },
    toggleRow: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.card,
      flexDirection: 'row',
      gap: theme.spacing.lg,
      justifyContent: 'space-between',
      minHeight: theme.sizes.touchTarget,
      padding: theme.spacing.lg,
    },
    toggleText: { flex: 1, gap: theme.spacing.xs },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    pressed: { opacity: 0.85 },
  });
}
