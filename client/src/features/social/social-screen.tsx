import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useApi, type FoodRequest } from '@/api';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useTheme } from '@/theme';

import { OfferSheet } from './offer-sheet';
import { RequestNote } from './request-note';
import { FoodTile, SocialError, SocialPage, socialStyles, TextAction } from './social-ui';
import { useSocialData } from './use-social-data';

export function SocialScreen() {
  const { api } = useApi();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const { fontScale } = useWindowDimensions();
  const [offering, setOffering] = useState<FoodRequest | null>(null);
  const state = useSocialData(useCallback(async () => {
    const [pantry, board] = await Promise.all([api.getShare(), api.getRequests()]);
    return { listings: pantry.listings, requests: board.requests };
  }, [api]));
  const widgetStyles = StyleSheet.create({
    widget: { backgroundColor: theme.colors.lime, borderRadius: theme.radii.hero, padding: theme.spacing.lg, gap: theme.spacing.md },
    widgetTitle: { ...theme.type.sectionHeading, color: theme.colors.onLime },
    widgetMeta: { ...theme.type.meta, color: theme.colors.onLime },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    tile: { flexGrow: 1, flexBasis: fontScale > 1 ? '40%' : '20%', alignItems: 'center',
      borderRadius: theme.radii.control, padding: theme.spacing.sm, gap: theme.spacing.sm, backgroundColor: theme.colors.surface },
    tileName: { ...theme.type.badge, color: theme.colors.ink, textAlign: 'center' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.spacing.md },
    note: { width: fontScale > 1 ? '100%' : '48%' },
  });
  return <SocialPage title="Social" screen="social" back={false} action={<IconButton icon="account-plus-outline"
    label="Add friends or groups" testID="social.connect.button" onPress={() => router.push('/social/connect')} />}>
    {state.status === 'loading' ? <SkeletonRows testID="social.loading.skeleton" /> : null}
    {state.status === 'error' ? <SocialError screen="social" message={state.error} onRetry={() => void state.reload()} /> : null}
    {state.status === 'ready' && state.data ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Food Pantry, shared by friends and groups"
        testID="social.pantry.widget" style={widgetStyles.widget} onPress={() => router.push('/social/pantry')}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}><Text style={widgetStyles.widgetTitle}>Food Pantry</Text>
            <Text style={widgetStyles.widgetMeta}>Shared by friends and groups</Text></View>
          <AppIcon name="chevron-right" color={theme.colors.onLime} />
        </View>
        <View style={widgetStyles.tiles}>
          {state.data.listings.slice(0, 3).map((listing) => <View key={listing.id} style={widgetStyles.tile}>
            <FoodTile listing={listing} /><Text style={widgetStyles.tileName}>{listing.item.name}</Text>
          </View>)}
          {state.data.listings.length > 3 ? <View style={widgetStyles.tile}><Text style={styles.heading}>+{state.data.listings.length - 3}</Text>
            <Text style={styles.meta}>more</Text></View> : null}
          {!state.data.listings.length ? <Text style={widgetStyles.widgetMeta}>No food shared yet</Text> : null}
        </View>
      </Pressable>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text accessibilityRole="header" style={styles.heading}>Requests</Text>
        <View style={styles.row}><TextAction label="Yours" accessibilityLabel="Your requests" testID="social.yours.button"
          onPress={() => router.push('/social/my-requests')} />
          <IconButton icon="plus-circle" label="Ask for something" testID="social.ask.button" onPress={() => router.push('/social/request-new')} />
        </View>
      </View>
      {!state.data.requests.length ? <StateView icon="note-outline" title="No requests yet" message="Ask your friends and groups for something you need."
        testID="social.empty.state" actionLabel="Ask for something" actionTestID="social.empty.ask" onAction={() => router.push('/social/request-new')} /> : null}
      <View style={widgetStyles.grid}>{state.data.requests.map((request, index) => <FadeIn key={request.id}
        style={widgetStyles.note} delay={Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.socialStaggerMs}>
        <RequestNote request={request} lime={index % 4 === 1 || index % 4 === 2} onOffer={() => setOffering(request)} />
      </FadeIn>)}</View>
    </> : null}
    {offering ? <OfferSheet key={offering.id} request={offering} onClose={() => setOffering(null)}
      onFulfilled={(request) => state.updateData((data) => ({ ...data, requests: data.requests.filter((note) => note.id !== request.id) }))} /> : null}
  </SocialPage>;
}
