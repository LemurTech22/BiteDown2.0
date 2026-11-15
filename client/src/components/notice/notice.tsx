import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAnimatedValue } from '@/hooks/use-animated-value';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

const NOTICE_MS = 3000;
const NoticeContext = createContext<{ show: (text: string) => void } | null>(null);

export function NoticeProvider({ children }: PropsWithChildren) {
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  const show = useCallback((text: string) => setNotice({ text }), []);
  const value = useMemo(() => ({ show }), [show]);
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
    {notice ? <SafeAreaView edges={['top', 'left', 'right']} style={styles.container} testID="app.notice.container">
      <Animated.View style={[styles.notice, { opacity }]}>
        <Text testID="app.notice" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.text}>{notice.text}</Text>
      </Animated.View>
    </SafeAreaView> : null}
  </NoticeContext.Provider>;
}

export function useNotice() {
  const notice = useContext(NoticeContext);
  if (!notice) throw new Error('useNotice must be used within NoticeProvider');
  return notice;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: { position: 'absolute', pointerEvents: 'none', top: 0, width: '100%', maxWidth: theme.sizes.webMaxContentWidth,
      alignSelf: 'center', padding: theme.spacing.sm },
    notice: { backgroundColor: theme.colors.forest, borderRadius: theme.radii.chip, padding: theme.spacing.md },
    text: { ...theme.type.bodySmall, color: theme.colors.onForest },
  });
}
