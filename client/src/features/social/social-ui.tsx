import { router, Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PantryListing } from '@/api';
import { AppIcon } from '@/components/ui/app-icon';
import { IconButton } from '@/components/ui/icon-button';
import { StateView } from '@/components/ui/state-view';
import { ItemThumb } from '@/components/ui/item-thumb';
import { type AppTheme, useTheme } from '@/theme';

import { expiryLabel, listingGroup } from './social-utils';

export function backToSocial() {
  if (router.canGoBack()) router.back();
  else router.replace('/social');
}
export function SocialPage({ title, screen, back = true, action, subtitle, children, leading }: {
  title: string; screen: string; back?: boolean; action?: ReactNode; subtitle?: string;
  children: ReactNode; leading?: ReactNode;
}) {
  const styles = socialStyles(useTheme());
  return <SafeAreaView style={styles.screen} edges={back ? ['top', 'bottom'] : ['top']} testID={`${screen}.screen.root`}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}>
      {leading ?? (back ? <IconButton icon="chevron-left" label="Back" testID={`${screen}.back.button`} onPress={backToSocial} /> : null)}
      <View style={styles.titleCopy}><Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.meta}>{subtitle}</Text> : null}</View>
      {action}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll} contentContainerStyle={styles.content}>{children}</ScrollView>
  </SafeAreaView>;
}
export function TextAction({ label, accessibilityLabel = label, testID, onPress, disabled = false, filled = false, danger = false, chevron = false }: {
  label: string; accessibilityLabel?: string; testID: string; onPress: () => void;
  disabled?: boolean; filled?: boolean; danger?: boolean; chevron?: boolean;
}) {
  const theme = useTheme();
  const styles = socialStyles(theme);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }}
    testID={testID} disabled={disabled} onPress={onPress}
    style={[styles.textAction, filled && styles.filledAction, danger && styles.dangerAction]}>
    <Text style={[styles.actionText, filled && styles.filledText, danger && styles.error]}>{label}</Text>
    {chevron ? <AppIcon name="chevron-right" color={theme.colors.forest} size={theme.sizes.iconSmall} /> : null}
  </Pressable>;
}
export function SocialError({ screen, message, onRetry }: { screen: string; message: string; onRetry: () => void }) {
  return <StateView icon="cloud-off-outline" title="Something went wrong" message={message} testID={`${screen}.error.state`}
    actionLabel="Try again" actionTestID={`${screen}.error.retry`} onAction={onRetry} />;
}
export function ExpiryBadge({ date, testID }: { date: string | null; testID: string }) {
  const styles = socialStyles(useTheme());
  const expiry = expiryLabel(date);
  if (!expiry) return null;
  return <View accessible accessibilityLabel={`Expiry: ${expiry.label}`} testID={testID}
    style={[styles.badge, expiry.urgent && styles.urgentBadge]}>
    <Text style={[styles.badgeText, expiry.urgent && styles.error]}>{expiry.label}</Text>
  </View>;
}
export function FoodTile({ listing }: { listing: PantryListing }) {
  const group = listingGroup(listing);
  return <ItemThumb name={listing.item.name} foodGroup={group} photoUrl={listing.item.photo_url} />;
}
export function socialStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.tileGap, padding: theme.spacing.gutter },
    titleCopy: { flex: 1, minWidth: '45%', gap: theme.spacing.xxs },
    title: { ...theme.type.screenTitle, color: theme.colors.ink },
    heading: { ...theme.type.sectionHeading, color: theme.colors.ink },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    body: { ...theme.type.body, color: theme.colors.inkSecondary },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    scroll: { flex: 1 },
    content: { flexGrow: 1, gap: theme.spacing.lg, paddingHorizontal: theme.spacing.gutter, paddingBottom: theme.spacing.xxl },
    section: { gap: theme.spacing.md },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.lg, gap: theme.spacing.md },
    note: { backgroundColor: theme.colors.noteYellow, padding: theme.spacing.tileInner, gap: theme.spacing.tileGap,
      borderRadius: theme.spacing.xs, borderBottomRightRadius: theme.radii.control },
    noteLime: { backgroundColor: theme.colors.noteLime },
    textAction: { minHeight: theme.sizes.touchTarget, minWidth: theme.sizes.touchTarget, paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.spacing.xxs,
      borderRadius: theme.radii.input, flexShrink: 1 },
    actionText: { ...theme.type.badge, color: theme.colors.forest, flexShrink: 1 },
    filledAction: { backgroundColor: theme.colors.forest, paddingHorizontal: theme.spacing.tileInner },
    filledText: { color: theme.colors.onForest },
    dangerAction: { backgroundColor: theme.colors.surface, borderWidth: theme.sizes.borderHairline, borderColor: theme.colors.urgentInk },
    error: { color: theme.colors.urgentInk },
    badge: { borderRadius: theme.radii.chip, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xxs,
      backgroundColor: theme.colors.limeTint, alignSelf: 'flex-start' },
    badgeText: { ...theme.type.badge, color: theme.colors.forest },
    urgentBadge: { backgroundColor: theme.colors.urgentBg },
  });
}
