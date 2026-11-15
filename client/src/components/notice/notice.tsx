import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

const NOTICE_MS = 3000;
const NoticeContext = createContext<{ show: (text: string) => void; setBottomClearance: (height: number) => void } | null>(null);

export function NoticeProvider({ children }: PropsWithChildren) {
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const [bottomClearance, setBottomClearance] = useState(0);
  const show = useCallback((text: string) => setNotice({ text }), []);
  const value = useMemo(() => ({ show, setBottomClearance }), [show]);
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const opacity = useAnimatedValue(1);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!notice) return;
    opacity.setValue(reducedMotion ? 1 : 0);
    const animation = reducedMotion ? null : Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: theme.motion.quickMs, useNativeDriver: true }),
      Animated.delay(Math.max(0, NOTICE_MS - 2 * theme.motion.quickMs)),
      Animated.timing(opacity, { toValue: 0, duration: theme.motion.quickMs, useNativeDriver: true }),
    ]);
    animation?.start();
    return () => animation?.stop();
  }, [notice, opacity, reducedMotion, theme.motion.quickMs]);

  return <NoticeContext.Provider value={value}>
    {children}
    {notice ? <SafeAreaView edges={['bottom', 'left', 'right']}
      style={[styles.container, { bottom: theme.sizes.tabBar + bottomClearance }]} testID="app.notice.container">
      <Animated.View style={[styles.notice, { opacity }]}>
        <Text testID="app.notice" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.text}>{notice.text}</Text>
      </Animated.View>
    </SafeAreaView> : null}
  </NoticeContext.Provider>;
}

// A notice is non-critical: outside a NoticeProvider (a test harness, a screen mounted on its own) it is a no-op
// instead of crashing the screen. Dev builds warn so a missing provider in the app is still noticed.
const NO_NOTICE = { show: (text: string) => { if (__DEV__) console.warn(`useNotice outside NoticeProvider: "${text}" not shown`); } };

export function useNotice() {
  return useContext(NoticeContext) ?? NO_NOTICE;
}

const NO_CLEARANCE = () => {};
// The focused Fridge screen reserves its measured Undo overlay; standalone screens need no provider.
export function useNoticeBottomClearance() {
  return useContext(NoticeContext)?.setBottomClearance ?? NO_CLEARANCE;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { position: 'absolute', pointerEvents: 'none', width: '100%', maxWidth: theme.sizes.webMaxContentWidth,
      alignSelf: 'center', padding: theme.spacing.sm },
    notice: { backgroundColor: theme.colors.forest, borderRadius: theme.radii.chip, padding: theme.spacing.md },
    text: { ...theme.type.bodySmall, color: theme.colors.onForest },
  });
}
