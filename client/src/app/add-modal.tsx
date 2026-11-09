import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { type AppTheme, useTheme } from '@/theme';

export default function AddModalScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content} testID="add.empty.state">
        <View style={styles.header}>
          <Text style={styles.title}>Add food</Text>
          <IconButton icon="close" label="Close add food" onPress={() => router.back()} testID="add.close.button" />
        </View>
        <View style={styles.photoTile}>
          <View style={styles.photoIcon}>
            <AppIcon name="camera-outline" color={theme.colors.onLime} size={theme.sizes.addHeroGlyph} />
          </View>
          <View style={styles.photoText}>
            <Text style={styles.photoTitle}>Snap a photo</Text>
            <Text style={styles.photoMeta}>Photo adding comes next.</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { gap: theme.spacing.xl, padding: theme.spacing.gutter },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink },
    photoTile: {
      alignItems: 'center',
      backgroundColor: theme.colors.forest,
      borderRadius: theme.radii.hero,
      flexDirection: 'row',
      gap: theme.spacing.lg,
      minHeight: theme.sizes.addHero,
      padding: theme.spacing.lg,
    },
    photoIcon: {
      alignItems: 'center',
      backgroundColor: theme.colors.lime,
      borderRadius: theme.radii.row,
      height: theme.sizes.addHeroIcon,
      justifyContent: 'center',
      width: theme.sizes.addHeroIcon,
    },
    photoText: { flex: 1, gap: theme.spacing.xs },
    photoTitle: { ...theme.type.sectionHeading, color: theme.colors.onForest },
    photoMeta: { ...theme.type.bodySmall, color: theme.colors.onForestMuted },
  });
}
