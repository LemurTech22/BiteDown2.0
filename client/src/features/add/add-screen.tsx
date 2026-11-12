import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { type AppTheme, useTheme } from '@/theme';

import { AddReviewLayout } from './add-review-layout';

export function AddScreen({ title, screen, children, footer }: {
  title: string; screen: string; children: ReactNode; footer?: ReactNode;
}) {
  const styles = addStyles(useTheme());
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <AddReviewLayout footer={footer}>
      <View style={styles.header}>
        <IconButton icon="arrow-left" label="Back" testID={`${screen}.back.button`}
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/home'); }} />
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
      {children}
    </AddReviewLayout>
  </SafeAreaView>;
}

export function addStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, padding: theme.spacing.gutter, gap: theme.spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    section: { gap: theme.spacing.md },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink, flexShrink: 1 },
    heading: { ...theme.type.sectionHeading, color: theme.colors.ink },
    body: { ...theme.type.bodySmall, color: theme.colors.muted },
    label: { ...theme.type.formLabel, color: theme.colors.inkSecondary },
    input: { ...theme.type.bodyLarge, color: theme.colors.ink, backgroundColor: theme.colors.surface,
      minHeight: theme.sizes.input, borderRadius: theme.radii.input, borderWidth: theme.sizes.borderHairline,
      borderColor: theme.colors.border, padding: theme.spacing.md },
    multiline: { minHeight: theme.sizes.input * 2, textAlignVertical: 'top' },
    card: { padding: theme.spacing.lg, borderRadius: theme.radii.card, backgroundColor: theme.colors.surface, gap: theme.spacing.md },
  });
}
