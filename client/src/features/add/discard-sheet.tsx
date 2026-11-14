import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/ui/app-button';
import { bottomSheetPanelStyle } from '@/components/ui/bottom-sheet-panel-style';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

export function DiscardSheet({ onDiscard, onCancel }: { onDiscard: () => void; onCancel: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet"
      onRequestClose={onCancel} testID="add.discard.sheet">
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View accessibilityViewIsModal style={[styles.sheet, bottomSheetPanelStyle(theme)]}>
            <Text accessibilityRole="header" style={styles.title}>Discard unsaved food?</Text>
            <Text style={styles.body}>These items haven’t been added yet.</Text>
            <AppButton label="Keep editing" testID="add.discard.cancel" onPress={onCancel} />
            <AppButton label="Discard" testID="add.discard.confirm" variant="outline" onPress={onDiscard} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, justifyContent: 'flex-end' },
    sheet: { padding: theme.spacing.gutter, gap: theme.spacing.sheetSection },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink },
    body: { ...theme.type.body, color: theme.colors.muted },
  });
}
