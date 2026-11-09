import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_API_BASE_URL, useApi } from '@/api';
import { SectionError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { type AppTheme, useTheme } from '@/theme';

export function DebugSettingsScreen() {
  const theme = useTheme();
  const { baseUrl, demoMode, setBaseUrl, setDemoMode } = useApi();
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const busy = useRef(false);
  const styles = createStyles(theme);

  async function saveServerAddress() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setMessage('');
    setError(null);
    retry.current = saveServerAddress;
    try {
      await setBaseUrl(draft ?? baseUrl);
      setDraft(null);
      setMessage('Server address saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Enter a valid server address.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function changeDemoMode(value: boolean) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    retry.current = () => changeDemoMode(value);
    try {
      await setDemoMode(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t save demo mode.');
    } finally {
      busy.current = false;
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
            editable={!saving}
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
          <AppButton label="Save server address" testID="settings.server.save" loading={saving} onPress={() => void saveServerAddress()} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset server address to default"
            testID="settings.server.reset"
            disabled={saving}
            onPress={() => setDraft(DEFAULT_API_BASE_URL)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>Reset to default</Text>
          </Pressable>
          {message ? (
            <Text accessibilityRole="alert" style={styles.message}>
              {message}
            </Text>
          ) : null}
          {error ? <SectionError title="Couldn’t save settings" message={error} testID="debug.error.state"
            onRetry={() => { if (retry.current) void retry.current(); }} /> : null}
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.label}>Demo mode</Text>
            <Text style={styles.meta}>Use in-memory data. No API or Gemini calls.</Text>
          </View>
          <Switch
            accessibilityLabel="Demo mode"
            testID="settings.demo.switch"
            disabled={saving}
            onValueChange={(value) => void changeDemoMode(value)}
            thumbColor={theme.colors.surface}
            trackColor={{ false: theme.colors.track, true: theme.colors.forest }}
            value={demoMode}
            style={styles.switch}
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
    switch: { minHeight: theme.sizes.touchTarget, minWidth: theme.sizes.touchTarget },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    pressed: { opacity: 0.85 },
  });
}
