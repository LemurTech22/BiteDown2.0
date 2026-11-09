import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { type AppTheme, useTheme } from '@/theme';

interface StateViewProps {
  icon: IconName;
  title: string;
  message: string;
  testID: string;
  actionLabel?: string;
  actionTestID?: string;
  onAction?: () => void;
}

export function StateView({ icon, title, message, testID, actionLabel, actionTestID, onAction }: StateViewProps) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <FadeIn style={styles.container} testID={testID}>
      <View style={styles.iconCircle}>
        <AppIcon name={icon} color={theme.colors.forest} size={theme.sizes.emptyGlyph} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && actionTestID && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} testID={actionTestID} />
      ) : null}
    </FadeIn>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      flexGrow: 1,
      gap: theme.spacing.md,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.gutter,
      paddingVertical: theme.spacing.xxl,
    },
    iconCircle: {
      alignItems: 'center',
      backgroundColor: theme.colors.limeTint,
      borderRadius: theme.radii.round,
      height: theme.sizes.emptyIcon,
      justifyContent: 'center',
      width: theme.sizes.emptyIcon,
    },
    title: { ...theme.type.sheetTitleCompact, color: theme.colors.ink, textAlign: 'center' },
    message: { ...theme.type.bodySmall, color: theme.colors.muted, textAlign: 'center' },
  });
}
