import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

import { AppButton } from './app-button';
import { bottomSheetPanelStyle } from './bottom-sheet-panel-style';

export function EditSheet({ title, testID, pending = false, onClose, children }: {
  title: string; testID: string; pending?: boolean; onClose: () => void; children: ReactNode;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  return <Modal visible animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet"
    onRequestClose={() => { if (!pending) onClose(); }} testID={testID}>
    <SafeAreaView style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <View accessibilityViewIsModal style={[styles.panel, bottomSheetPanelStyle(theme)]} testID={`${testID}.panel`}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {children}
          <AppButton label="Cancel" variant="outline" disabled={pending} onPress={onClose} testID={`${testID}.cancel`} />
        </View>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, justifyContent: 'flex-end' },
    panel: { padding: theme.spacing.gutter, gap: theme.spacing.sheetSection },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink },
  });
}
