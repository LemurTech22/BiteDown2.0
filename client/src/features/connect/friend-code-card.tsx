import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import { useApi, type FriendCode } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { CodeQr, connectStyles } from '@/features/connect/connect-ui';
import { colors, useTheme } from '@/theme';

export function FriendCodeCard() {
  const { api } = useApi();
  const theme = useTheme();
  const styles = connectStyles(theme);
  const [code, setCode] = useState<FriendCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const expiredCode = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const next = await api.getFriendCode();
      if (request !== sequence.current) return;
      if (!Number.isFinite(Date.parse(next.expires_at)) || Date.parse(next.expires_at) <= Date.now()) {
        throw new Error('Couldn’t refresh your code.');
      }
      setCode(next);
      setNow(Date.now());
      expiredCode.current = null;
    } catch {
      if (request === sequence.current) setError('Couldn’t refresh your code.');
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { subscription.remove(); clearInterval(timer); sequence.current += 1; };
  }, [refresh]));

  const seconds = code ? Math.max(0, Math.ceil((Date.parse(code.expires_at) - now) / 1000)) : 0;
  useEffect(() => {
    if (!code || seconds > 0 || expiredCode.current === code.code) return;
    expiredCode.current = code.code;
    void refresh();
  }, [code, seconds, refresh]);

  async function copy() {
    if (!code || loading || Date.parse(code.expires_at) <= Date.now()) return;
    setCopyError(null);
    try {
      const didCopy = await Clipboard.setStringAsync(`bitedown://friend/${code.code}`);
      if (!didCopy) throw new Error('Copy failed');
      setCopied(true);
    } catch {
      setCopyError('Couldn’t copy your code. Try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  return <View style={[styles.card, { backgroundColor: theme.colors.lime }]} testID="connect.code.card">
    <View style={styles.row}>
      {!loading && !error && code && seconds > 0 ? <CodeQr value={`bitedown://friend/${code.code}`}
        label="My friend code, QR" testID="connect.code.qr" /> : null}
      <View style={[styles.copy, { minWidth: '40%' }]}>
        <Text accessibilityRole="header" style={[theme.type.cardHeading, { color: colors.light.ink }]}>My code</Text>
        <Text style={[theme.type.meta, { color: colors.light.inkSecondary }]}>Refreshes every 10 min</Text>
        {!loading && !error && code && seconds > 0 ? <Text accessibilityRole="timer"
          accessibilityLabel={`New code in ${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`}
          testID="connect.code.countdown" style={[theme.type.meta, { color: colors.light.ink, fontVariant: ['tabular-nums'] }]}>
          New code in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </Text> : null}
      </View>
    </View>
    {loading ? <SkeletonRows testID="connect.code.loading" /> : error ? <>
      <Text accessibilityRole="alert" style={[styles.error, { color: colors.light.urgentInk }]}>{error}</Text>
      <AppButton label="Try again" testID="connect.code.retry" onPress={() => void refresh()} />
    </> : null}
    <AppButton label="Scan a friend's code" testID="connect.code.scan" onPress={() => router.push('/social/scan')} />
    <Pressable accessibilityRole="button" accessibilityLabel="Copy my code" accessibilityState={{ disabled: loading || seconds === 0 }}
      disabled={loading || seconds === 0} testID="connect.code.copy" onPress={() => void copy()}
      style={[styles.toggle, { backgroundColor: theme.colors.lime, borderColor: colors.light.ink, borderWidth: theme.sizes.focusRing }]}>
      <Text style={[theme.type.button, { color: colors.light.ink }]}>Copy</Text>
    </Pressable>
    {copied ? <Text accessibilityLiveRegion="polite" style={{ ...theme.type.meta, color: colors.light.ink }}>Copied</Text> : null}
    {copyError ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.light.urgentInk }]}>{copyError}</Text> : null}
  </View>;
}
