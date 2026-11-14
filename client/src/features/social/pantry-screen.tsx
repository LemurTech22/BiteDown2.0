import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { usePreferences } from '@/settings/preferences';
import { useTheme } from '@/theme';

import { ExpiryBadge, FoodTile, SocialError, SocialPage, socialStyles, TextAction } from './social-ui';
import { listingQuantity } from './social-utils';
import { errorMessage, useSocialData } from './use-social-data';

const FILTERS = ['All', 'Friends', 'Groups'] as const;

export function PantryScreen() {
  const { api } = useApi();
  const { units } = usePreferences();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const state = useSocialData(useCallback(async () => {
    const [{ listings }, response] = await Promise.all([api.getShare(), api.getItems()]);
    const items = 'sections' in response ? response.sections.flatMap((section) => section.items) : response.items;
    return { listings, mine: items.filter((item) => item.share?.status === 'open' && !item.removed_at && !item.group_id) };
  }, [api]));
  const [filter, setFilter] = useState<typeof FILTERS[number]>('All');
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const busy = useRef(false);
  async function claim(id: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(id);
    setFailed(null);
    try {
      const { listing } = await api.claimShare(id);
      state.updateData((data) => ({ ...data, listings: data.listings.map((entry) => entry.id === id ? {
        ...entry, claimed_by_me: true, pickup: listing.pickup, pickup_set: listing.pickup_set,
      } : entry) }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      reportServerError(cause);
      setFailed({ id, message: errorMessage(cause) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  const listings = state.data?.listings.filter((entry) => filter === 'All' || entry.source.type === (filter === 'Friends' ? 'friend' : 'group')) ?? [];
  const mine = state.data?.mine ?? [];
  return <SocialPage title="Food Pantry" screen="foodPantry" subtitle="Shared by friends and groups">
    <View accessibilityRole="tablist" accessibilityLabel="Source" style={[styles.row, {
      backgroundColor: theme.colors.track, padding: theme.spacing.xs, borderRadius: theme.radii.control,
    }]}>{FILTERS.map((value) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value}
      accessibilityState={{ selected: filter === value }} testID={`foodPantry.filter.${value.toLowerCase()}`} onPress={() => setFilter(value)}
      style={{ flex: 1, minHeight: theme.sizes.touchTarget, justifyContent: 'center', alignItems: 'center',
        padding: theme.spacing.sm, borderRadius: theme.radii.chip, backgroundColor: filter === value ? theme.colors.surface : theme.colors.track }}>
      <Text style={filter === value ? styles.name : styles.meta}>{value}</Text>
    </Pressable>)}</View>
    {state.status === 'loading' ? <SkeletonRows testID="foodPantry.loading.skeleton" /> : null}
    {state.status === 'error' ? <SocialError screen="foodPantry" message={state.error} onRetry={() => void state.reload()} /> : null}
    {failed ? <SocialError screen="foodPantry.claim" message={failed.message} onRetry={() => void claim(failed.id)} /> : null}
    {pending ? <SkeletonRows testID="foodPantry.claim.skeleton" /> : null}
    {state.status === 'ready' && filter === 'All' && mine.length > 0 ? <View style={styles.section}>
      <Text accessibilityRole="header" testID="foodPantry.mine.header" style={styles.heading}>You&apos;re sharing</Text>
      {mine.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}, shared by you`}
        testID={`foodPantry.mine.${item.id}`} style={[styles.card, styles.row, { minHeight: theme.sizes.touchTarget }]}
        onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text style={styles.name}>{item.name}, {quantityLabel(item, units)}</Text>
          <Text style={styles.meta}>{item.share?.claimed_by ? `Claimed by ${item.share.claimed_by.name}` : 'Not claimed yet'}</Text>
        </View>
        <ExpiryBadge date={item.predicted_expiry} testID={`foodPantry.mine.expiry.${item.id}`} />
      </Pressable>)}
    </View> : null}
    {state.status === 'ready' && !listings.length && (filter !== 'All' || !mine.length) ? <StateView icon="basket-outline" title="No shared food yet"
      message={filter === 'All' ? 'Food shared by your friends and groups appears here.' : `No food shared by ${filter.toLowerCase()} right now.`}
      testID="foodPantry.empty.state" /> : null}
    {state.status === 'ready' ? listings.map((listing) => <View key={listing.id} style={[styles.card, styles.row]}
      testID={`foodPantry.item.${listing.id}`}>
      <FoodTile listing={listing} />
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: '45%', gap: theme.spacing.xs }}>
        <Text style={styles.name}>{listing.item.name}, {listingQuantity(listing, units)}</Text>
        <View style={styles.row}><Text style={styles.meta}>{listing.source.name}</Text>
          <ExpiryBadge date={listing.item.predicted_expiry} testID={`foodPantry.expiry.${listing.id}`} /></View>
        {listing.pickup_set ? <View style={styles.row} testID={`foodPantry.pickup.${listing.id}`}>
          <AppIcon name="map-marker-outline" color={theme.colors.muted} size={theme.sizes.iconSmall} />
          <Text style={styles.meta}>Pickup spot set</Text>
        </View> : null}
      </View>
      {listing.claimed_by_me ? <TextAction label="Claimed" chevron accessibilityLabel="Claimed by you: view pickup"
        testID={`foodPantry.claimed.${listing.id}`} onPress={() => router.push({ pathname: '/social/claimed/[id]', params: { id: listing.id } })} /> :
        <TextAction label={pending === listing.id ? 'Claiming…' : 'Claim'} filled disabled={pending !== null}
          accessibilityLabel={`Claim ${listing.item.name}`} testID={`foodPantry.claim.${listing.id}`} onPress={() => void claim(listing.id)} />}
    </View>) : null}
  </SocialPage>;
}
