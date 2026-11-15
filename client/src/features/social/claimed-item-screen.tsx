import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { useApi } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { usePreferences } from '@/settings/preferences';
import { useTheme } from '@/theme';

import { mapsUrl } from './maps-url';
import { ExpiryBadge, FoodTile, SocialError, SocialPage, socialStyles } from './social-ui';
import { listingQuantity } from './social-utils';
import { errorMessage, useSocialData } from './use-social-data';

export function ClaimedItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApi();
  const { units } = usePreferences();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const state = useSocialData(useCallback(async () => {
    const { listings } = await api.getShare();
    return listings.find((listing) => listing.id === id && listing.claimed_by_me) ?? null;
  }, [api, id]));
  const [mapError, setMapError] = useState('');
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const listing = state.data;
  const pickup = listing?.pickup;
  async function openMaps() {
    if (!pickup || pickup.lat === null || pickup.lng === null || busy.current) return;
    busy.current = true;
    setOpening(true);
    setMapError('');
    try {
      await Linking.openURL(mapsUrl({ lat: pickup.lat, lng: pickup.lng, label: pickup.place_name ?? undefined }));
    } catch (cause) {
      setMapError(errorMessage(cause));
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }
  return <SocialPage title="Claimed item" screen="claimedItem">
    {state.status === 'loading' ? <SkeletonRows testID="claimedItem.loading.skeleton" /> : null}
    {state.status === 'error' ? <SocialError screen="claimedItem" message={state.error} onRetry={() => void state.reload()} /> : null}
    {state.status === 'ready' && !listing ? <StateView icon="basket-outline" title="Item no longer available"
      message="This listing may have been handed over or removed." testID="claimedItem.empty.state" /> : null}
    {state.status === 'ready' && listing ? <>
      <View style={styles.row} testID={`claimedItem.item.${listing.id}`}>
        <FoodTile listing={listing} />
        <View style={{ flex: 1, gap: theme.spacing.sm }}><Text accessibilityRole="header" style={styles.heading}>
          {listing.item.name}, {listingQuantity(listing, units)}
        </Text><View style={styles.row}><Text style={styles.meta}>From {listing.owner_name}</Text>
          <ExpiryBadge date={listing.item.predicted_expiry} testID="claimedItem.expiry.badge" /></View></View>
      </View>
      <View style={[styles.card, styles.row, { backgroundColor: theme.colors.limeTint }]} testID="claimedItem.status.claimed">
        <AppIcon name="account-check-outline" color={theme.colors.forest} /><Text style={styles.badgeText}>You claimed this</Text>
      </View>
      {pickup ? <View style={styles.card} testID="claimedItem.pickup.card">
        <View style={styles.row}><AppIcon name="map-marker-outline" color={theme.colors.forest} />
          <Text accessibilityRole="header" style={styles.name}>Pickup spot</Text></View>
        {pickup.place_name ? <Text style={styles.name}>{pickup.place_name}</Text> : null}
        {pickup.note ? <Text style={styles.body}>{pickup.note}</Text> : null}
      </View> : null}
      {pickup && pickup.lat !== null && pickup.lng !== null ? <AppButton label="Open in Maps" testID="claimedItem.maps.button"
        accessibilityLabel={`Open ${pickup.place_name ?? 'pickup spot'} in Maps`} onPress={() => void openMaps()} loading={opening} /> : null}
      {mapError ? <SocialError screen="claimedItem.maps" message={mapError} onRetry={() => void openMaps()} /> : null}
    </> : null}
  </SocialPage>;
}
