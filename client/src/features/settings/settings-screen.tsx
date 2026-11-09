import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type AuthMeResponse } from '@/api';
import { useAuth } from '@/auth/auth-provider';
import { SectionError, useServerErrorReporter } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type Preferences, usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

const DELETION_COPY = 'Deleting your account removes your food, friends and groups. Your past impact stays in totals anonymously.';
const STORAGES = [{ value: 'fridge', label: 'Fridge' }, { value: 'pantry', label: 'Pantry' }, { value: 'freezer', label: 'Freezer' }] as const;
type Editor = 'units' | 'storage' | 'currency' | null;

export function SettingsScreen() {
  const { api, baseUrl } = useApi();
  const { signOut } = useAuth();
  const preferences = usePreferences();
  const reportError = useServerErrorReporter();
  const styles = createStyles(useTheme());
  const reducedMotion = useReducedMotion();
  const [profile, setProfile] = useState<AuthMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [currency, setCurrency] = useState(preferences.currency);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const busy = useRef(false);
  const deleted = useRef(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.me();
      if (sequence === request.current) setProfile(response);
    } catch (error) {
      reportError(error);
      if (sequence === request.current) setLoadError(error instanceof Error ? error.message : 'Couldn’t load your profile.');
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [api, reportError]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; request.current += 1; };
  }, [load]);

  async function perform(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    retryAction.current = action;
    setPending(true);
    setActionError(null);
    try {
      await action();
      retryAction.current = null;
    } catch (error) {
      reportError(error);
      setActionError(error instanceof Error ? error.message : 'Couldn’t save your change. Try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function save(patch: Partial<Preferences>) {
    void perform(async () => {
      await preferences.updatePreferences(patch);
      setEditor(null);
    });
  }

  async function leave() {
    await signOut();
    router.replace('/');
  }

  async function deleteAccount() {
    if (!deleted.current) {
      await api.deleteMe();
      deleted.current = true;
      setAccountDeleted(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    await leave();
    setConfirming(false);
  }

  const actionErrorView = actionError ? (
    <SectionError title="Couldn’t complete that change" message={actionError} testID="settings.action.error"
      onRetry={() => { if (retryAction.current) void perform(retryAction.current); }} />
  ) : null;

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="settings.screen.content">
        <Text accessibilityRole="header" style={styles.title}>Profile</Text>
        {loading ? <SkeletonRows testID="settings.profile.loading" /> : loadError ? (
          <SectionError title="Couldn’t load your profile" message={loadError} onRetry={() => void load()} testID="settings.profile.error" />
        ) : profile?.user ? (
          <View style={styles.profile} testID="settings.profile.card">
            <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.initials}>{profile.user.display_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.name} testID="settings.profile.name">{profile.user.display_name}</Text>
              <Text style={styles.meta} testID="settings.profile.email">{profile.user.email}{profile.providers.includes('google') ? ' · signed in with Google' : ''}</Text>
            </View>
          </View>
        ) : <StateView icon="account-outline" title="No account details" message="Try loading your profile again." testID="settings.profile.empty"
          actionLabel="Try again" actionTestID="settings.profile.empty.retry" onAction={() => void load()} />}

        <Section title="Preferences">
          {!preferences.hydrated ? <SkeletonRows testID="settings.preferences.loading" /> : <>
            <SettingsRow label="Units" value={preferences.units === 'us' ? 'US (lb, oz)' : 'Metric (kg, g)'} id="units" disabled={pending}
              onPress={() => setEditor(editor === 'units' ? null : 'units')} expanded={editor === 'units'} />
            {editor === 'units' ? <View style={styles.choices}>
              <Choice label="US (lb, oz)" id="units.us" selected={preferences.units === 'us'} disabled={pending} onPress={() => save({ units: 'us' })} />
              <Choice label="Metric (kg, g)" id="units.metric" selected={preferences.units === 'metric'} disabled={pending} onPress={() => save({ units: 'metric' })} />
            </View> : null}
            <SettingsRow label="Default storage" value={STORAGES.find((storage) => storage.value === preferences.defaultStorage)?.label} id="storage" disabled={pending}
              onPress={() => setEditor(editor === 'storage' ? null : 'storage')} expanded={editor === 'storage'} />
            {editor === 'storage' ? <View style={styles.choices}>{STORAGES.map((storage) => <Choice key={storage.value}
              label={storage.label} id={`storage.${storage.value}`} selected={preferences.defaultStorage === storage.value} disabled={pending}
              onPress={() => save({ defaultStorage: storage.value })} />)}</View> : null}
            <SettingsRow label="Currency" value={preferences.currency} id="currency" disabled={pending}
              onPress={() => { setCurrency(preferences.currency); setCurrencyError(null); setEditor(editor === 'currency' ? null : 'currency'); }} expanded={editor === 'currency'} />
            {editor === 'currency' ? <View style={styles.choices}>
              <TextInput accessibilityLabel="Currency code" testID="settings.currency.input" value={currency} onChangeText={(value) => { setCurrency(value); setCurrencyError(null); }}
                autoCapitalize="characters" autoCorrect={false} maxLength={3} editable={!pending} style={styles.input} />
              <AppButton label="Save currency" testID="settings.currency.save" disabled={pending} onPress={() => {
                const code = currency.trim().toUpperCase();
                if (!/^[A-Z]{3}$/.test(code)) { setCurrencyError('Enter a three-letter currency code.'); return; }
                save({ currency: code });
              }} />
              {currencyError ? <Text accessibilityRole="alert" style={styles.destructive}>{currencyError}</Text> : null}
            </View> : null}
          </>}
        </Section>
        {preferences.error && !actionError ? <SectionError title="Preferences unavailable" message={preferences.error}
          testID="settings.preferences.error" onRetry={() => save({})} /> : null}
        <Section title="Account">
          <SettingsRow label="Sign out" id="signout" disabled={pending} onPress={() => void perform(leave)} />
          <SettingsRow label="Delete account…" id="delete" destructive disabled={pending}
            onPress={() => { setActionError(null); setConfirming(true); }} />
        </Section>
        <Text style={styles.meta}>{DELETION_COPY}</Text>
        <Section title="Debug">
          <SettingsRow label="Server address" value={baseUrl} id="server" onPress={() => router.push('/debug')} />
        </Section>
        {!confirming ? actionErrorView : null}
        <Text style={styles.version}>BiteDown {Constants.expoConfig?.version}</Text>
      </ScrollView>
      <Modal visible={confirming} animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet"
        onRequestClose={() => { if (!busy.current && !deleted.current) setConfirming(false); }} testID="settings.delete.modal">
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content}>
            <View accessibilityViewIsModal style={styles.confirmation}>
              <Text accessibilityRole="header" style={styles.title}>Delete account?</Text>
              <Text style={styles.body}>{DELETION_COPY}</Text>
              <AppButton label="Delete account" testID="settings.delete.confirm" loading={pending} onPress={() => void perform(deleteAccount)} />
              <AppButton label="Cancel" testID="settings.delete.cancel" variant="outline" disabled={pending || accountDeleted}
                onPress={() => { setConfirming(false); setActionError(null); }} />
              {actionErrorView}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = createStyles(useTheme());
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text><View style={styles.card}>{children}</View></View>;
}

function SettingsRow({ label, value, id, onPress, destructive = false, disabled = false, expanded }: {
  label: string; value?: string; id: string; onPress: () => void; destructive?: boolean; disabled?: boolean; expanded?: boolean;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}: ${value}` : label}
    accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled}
    testID={`settings.row.${id}`} onPress={onPress} style={styles.row}>
    <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
    {value ? <View style={styles.rowValue}><Text style={styles.value}>{value}</Text><AppIcon name="chevron-right" color={theme.colors.muted} size={theme.sizes.iconSmall} /></View> : null}
  </Pressable>;
}

function Choice({ label, id, selected, disabled, onPress }: { label: string; id: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }} disabled={disabled}
    testID={`settings.choice.${id}`} onPress={onPress} style={styles.choice}>
    <Text style={styles.rowLabel}>{label}</Text>{selected ? <AppIcon name="check" color={theme.colors.forest} /> : null}
  </Pressable>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, gap: theme.spacing.lg, padding: theme.spacing.gutter },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    profile: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.tileInner, padding: theme.spacing.lg, borderRadius: theme.radii.card, backgroundColor: theme.colors.surface },
    avatar: { width: theme.sizes.primaryButton, minHeight: theme.sizes.primaryButton, backgroundColor: theme.colors.forest, borderRadius: theme.radii.round, alignItems: 'center', justifyContent: 'center' },
    initials: { ...theme.type.sectionHeading, color: theme.colors.onForest },
    copy: { flex: 1, gap: theme.spacing.xxs },
    name: { ...theme.type.cardHeading, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    body: { ...theme.type.body, color: theme.colors.ink },
    section: { gap: theme.spacing.sm },
    sectionTitle: { ...theme.type.badge, textTransform: 'uppercase', color: theme.colors.muted },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, overflow: 'hidden' },
    row: { minHeight: theme.sizes.primaryButton, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm,
      padding: theme.spacing.lg, borderBottomWidth: theme.sizes.borderHairline, borderColor: theme.colors.hairline },
    rowLabel: { ...theme.type.body, color: theme.colors.forest, flexShrink: 1 },
    destructive: { color: theme.colors.urgentInk },
    rowValue: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: theme.spacing.xs },
    value: { ...theme.type.body, color: theme.colors.muted, flexShrink: 1 },
    choices: { padding: theme.spacing.lg, gap: theme.spacing.sm, backgroundColor: theme.colors.limeTint },
    choice: { minHeight: theme.sizes.touchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    input: { ...theme.type.body, color: theme.colors.ink, backgroundColor: theme.colors.surface, minHeight: theme.sizes.input, padding: theme.spacing.md,
      borderRadius: theme.radii.input, borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.border },
    version: { ...theme.type.meta, color: theme.colors.muted, marginTop: 'auto', textAlign: 'center' },
    confirmation: { gap: theme.spacing.lg },
  });
}
