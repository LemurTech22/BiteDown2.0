import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { isApiError, useApi, type Friend, type FriendsResponse } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { CodeField, connectStyles, initials } from '@/features/connect/connect-ui';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/theme';

const EXPIRED = 'That code expired. Ask them to show it again.';
const OWN_CODE = "That's your code. Scan a friend's instead.";

export function friendCode(value: string, scanned = false): string | null {
  const input = value.trim();
  const match = /^bitedown:\/\/friend\/([A-Za-z0-9_-]+)$/.exec(input);
  if (match) return match[1];
  return !scanned && /^[A-Za-z0-9_-]+$/.test(input) ? input : null;
}

export function ScanScreen() {
  const { api } = useApi();
  const theme = useTheme();
  const styles = connectStyles(theme);
  const reducedMotion = useReducedMotion();
  const params = useLocalSearchParams<{ code?: string }>();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(true);
  const [success, setSuccess] = useState<{ friend: Friend; existing: boolean } | null>(null);
  const camera = useRef<CameraView | null>(null);
  const requested = useRef(false);
  const locked = useRef(false);
  const succeeded = useRef(false);
  const lastScan = useRef({ code: '', at: 0 });
  const friends = useRef<Promise<FriendsResponse | null>>(Promise.resolve(null));
  const initialCode = useRef(false);

  useFocusEffect(useCallback(() => {
    setActive(AppState.currentState === 'active');
    friends.current = api.getFriends().catch((cause: unknown) => { reportServerError(cause); return null; });
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'active') void getPermission().then((next) => {
        if (next.granted) setCameraFailed(false);
      }).catch(() => {});
    });
    return () => { setActive(false); subscription.remove(); };
  }, [api, getPermission]));

  useEffect(() => {
    if (!permission || permission.granted || !permission.canAskAgain || requested.current) return;
    requested.current = true;
    void requestPermission().catch(() => setCameraFailed(true));
  }, [permission, requestPermission]);

  async function add(input: string, scanned = false) {
    if (locked.current || succeeded.current) return;
    const code = friendCode(input, scanned);
    if (!code && scanned) return;
    if (scanned && code === lastScan.current.code && Date.now() - lastScan.current.at < 2000) return;
    if (scanned && code) lastScan.current = { code, at: Date.now() };
    if (!code) {
      setError(EXPIRED);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      // Capture the pre-scan snapshot without delaying the POST.
      const previous = friends.current;
      const { friend } = await api.addFriend({ code });
      succeeded.current = true;
      void camera.current?.pausePreview().catch(() => {});
      const before = await previous;
      setSuccess({ friend, existing: !!before?.friends.some((entry) => entry.user_id === friend.user_id) });
      friends.current = Promise.resolve({ friends: [...(before?.friends ?? []).filter((entry) => entry.user_id !== friend.user_id), friend], incoming: [], outgoing: [] });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      reportServerError(cause);
      setError(isApiError(cause) && cause.status === 400 && cause.code === 'validation_error' ? OWN_CODE : EXPIRED);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (initialCode.current || !params.code) return;
    initialCode.current = true;
    void add(params.code);
    // The optional link parameter is consumed once, never on a render or permission change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  function close() { router.dismissTo('/social/connect'); }

  return <View style={[styles.screen, { backgroundColor: theme.colors.forestChip }]}>
    {permission?.granted && !cameraFailed && active ? <CameraView ref={camera} style={StyleSheet.absoluteFill}
      testID="friendScan.camera.preview" facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onMountError={() => setCameraFailed(true)}
      onBarcodeScanned={pending || success ? undefined : ({ data }) => { void add(data, true); }} /> : null}
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { padding: theme.spacing.gutter, backgroundColor: theme.colors.forestChip }]}>
          <IconButton icon="close" label="Close" testID="friendScan.close.button" onPress={close} />
          <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.onForestChip }]}>{"Scan a friend's code"}</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.gutter }}>
          {!permission ? <SkeletonRows testID="friendScan.permission.loading" /> : !permission.granted || cameraFailed ?
            <View style={styles.card}><StateView icon="camera-off-outline" title="Camera access is off" message=""
              testID="friendScan.camera.denied" actionLabel="Open Settings" actionTestID="friendScan.camera.settings"
              onAction={() => { void Linking.openSettings().catch(() => setError('Couldn’t open Settings. Try again.')); }} />
            </View> : <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={{ alignItems: 'center' }}>
              <Svg width={theme.sizes.brandMark * 3} height={theme.sizes.brandMark * 3} viewBox="0 0 240 240" testID="friendScan.camera.frame">
                <Path d="M4 52V22A18 18 0 0 1 22 4h30M188 4h30a18 18 0 0 1 18 18v30M236 188v30a18 18 0 0 1-18 18h-30M52 236H22A18 18 0 0 1 4 218v-30"
                  fill="none" stroke={theme.colors.lime} strokeWidth={theme.sizes.focusRing * 2} strokeLinecap="round" />
              </Svg>
            </View>}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={[styles.content, { backgroundColor: theme.colors.ground, borderTopLeftRadius: theme.radii.sheet, borderTopRightRadius: theme.radii.sheet }]}>
          <CodeField label="Type a code instead" value={value} onChangeText={(next) => { setValue(next); setError(null); }}
            editable={!pending} testID="friendScan.code.input" error={error} />
          {pending ? <SkeletonRows testID="friendScan.add.loading" /> : null}
          <AppButton label="Add" testID="friendScan.code.add" disabled={pending || !value.trim()} onPress={() => void add(value)} />
          {error ? <AppButton label="Try again" testID="friendScan.error.retry" disabled={pending}
            variant="outline" onPress={() => void add(value || lastScan.current.code)} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    <Modal visible={!!success} transparent animationType={reducedMotion ? 'fade' : 'slide'}
      onRequestClose={close} testID="friendAdded.sheet.modal">
      {success ? <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={[styles.content, { backgroundColor: theme.colors.ground,
          alignItems: 'center', borderTopLeftRadius: theme.radii.sheet, borderTopRightRadius: theme.radii.sheet }]}>
          <View accessibilityViewIsModal style={{ alignSelf: 'stretch', gap: theme.spacing.sheetSection, alignItems: 'center' }}>
            <View style={[styles.avatar, { minWidth: theme.sizes.brandMark, minHeight: theme.sizes.brandMark }]}>
              <Text style={[theme.type.screenTitle, { color: theme.colors.forest }]}>{initials(success.friend.display_name)}</Text>
              <View style={{ position: 'absolute', right: 0, bottom: 0, borderRadius: theme.radii.round,
                padding: theme.spacing.xs, backgroundColor: theme.colors.forest }}>
                <AppIcon name="check" color={theme.colors.onForest} />
              </View>
            </View>
            <Text role="status" accessibilityLiveRegion="polite" testID="friendAdded.success.title"
              style={[theme.type.sheetTitle, { color: theme.colors.ink, textAlign: 'center' }]}>
              {success.existing ? "You're already friends with " : "You're now friends with "}{success.friend.display_name}
            </Text>
            <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
              <AppButton label="Done" testID="friendAdded.done.button" onPress={close} />
              <AppButton label="Scan another code" testID="friendAdded.another.button" variant="outline" onPress={() => {
                setSuccess(null); setValue(''); setError(null); succeeded.current = false;
                lastScan.current = { code: '', at: 0 };
                void camera.current?.resumePreview().catch(() => {});
              }} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView> : null}
    </Modal>
  </View>;
}
