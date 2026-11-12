import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { type AppTheme, useTheme } from '@/theme';

export function AddReviewLayout({ children, footer, contentContainerStyle }: {
  children: ReactNode;
  footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return <SafeAreaView style={styles.fill} edges={footer ? [] : ['bottom']}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.fill} testID="addReview.scroll" keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, contentContainerStyle, { paddingBottom: theme.spacing.gutter }]}>
        {children}
      </ScrollView>
      {footer ? <ReviewFooter>{footer}</ReviewFooter> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function ReviewFooter({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  return <View testID="addReview.footer" style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.md) }]}>
    {children}
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    fill: { flex: 1, minHeight: 0 },
    content: { flexGrow: 1, padding: theme.spacing.gutter, gap: theme.spacing.lg },
    // The footer takes its own space in the layout; only the candidates scroll.
    footer: { flexShrink: 0, backgroundColor: theme.colors.surface,
      borderTopWidth: theme.sizes.borderHairline, borderTopColor: theme.colors.hairline,
      paddingHorizontal: theme.spacing.gutter, paddingTop: theme.spacing.md, gap: theme.spacing.sm },
  });
}
