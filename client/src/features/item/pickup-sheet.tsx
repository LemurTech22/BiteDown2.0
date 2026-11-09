import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PickupSpot } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

import { ItemField } from './item-field';

export function PickupSheet({ pickup, onSave, onClose }: {
  pickup: PickupSpot | null; onSave: (spot: PickupSpot | null) => Promise<void>; onClose: () => void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const preferences = usePreferences();
  const [spot, setSpot] = useState<PickupSpot>(pickup ?? { note: null, place_name: null, lat: null, lng: null });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const working = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const valid = Boolean(spot.note?.trim()) || (spot.lat !== null && spot.lng !== null);

  async function perform(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; retry.current = action; setPending(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Couldn’t update pickup spot. Try again.'); }
    finally { working.current = false; setPending(false); }
  }
  async function useLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location access is off. You can add a note instead.');
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setSpot((current) => ({ ...current, lat: location.coords.latitude, lng: location.coords.longitude }));
    setSaved(false);
  }
  async function save(value: PickupSpot | null) {
    await onSave(value ? { ...value, note: value.note?.trim() || null, place_name: value.place_name?.trim() || null } : null);
    onClose();
  }

  return <Modal visible animationType={reducedMotion ? 'fade' : 'slide'} presentationStyle="pageSheet"
    testID="item.pickup.sheet" onRequestClose={() => { if (!working.current) onClose(); }}>
    <SafeAreaView style={styles.screen}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.header}><AppButton label="Cancel" variant="outline" disabled={pending} testID="item.pickup.cancel" onPress={onClose} />
          <Text accessibilityRole="header" style={styles.title}>Pickup spot</Text>
          <AppButton label="Done" testID="item.pickup.done" disabled={pending || !valid} onPress={() => void perform(() => save(spot))} /></View>
        <ItemField label="Note" testID="item.pickup.note" value={spot.note ?? ''} maxLength={120} multiline editable={!pending}
          onChangeText={(note) => { setSpot({ ...spot, note }); setSaved(false); }} />
        <Text accessibilityLiveRegion="polite" accessibilityLabel={`${spot.note?.length ?? 0} of 120 characters`} style={styles.meta} testID="item.pickup.counter">{spot.note?.length ?? 0}/120</Text>
        <ItemField label="Place name" testID="item.pickup.place" value={spot.place_name ?? ''} maxLength={120} editable={!pending}
          onChangeText={(place_name) => { setSpot({ ...spot, place_name }); setSaved(false); }} />
        {spot.lat !== null && spot.lng !== null ? <View accessible accessibilityLabel={`Pickup pin at ${spot.place_name || `${spot.lat}, ${spot.lng}`}`} style={styles.pin} testID="item.pickup.pin">
          <AppIcon name="map-marker" color={theme.colors.forest} size={theme.sizes.iconLarge} />
          <Text style={styles.body}>{spot.lat.toFixed(5)}, {spot.lng.toFixed(5)}</Text>
        </View> : null}
        <AppButton label="Use my location" variant="outline" testID="item.pickup.location" disabled={pending} onPress={() => void perform(useLocation)} />
        {spot.lat !== null ? <AppButton label="Remove pin" testID="item.pickup.clearPin" variant="outline" disabled={pending}
          onPress={() => { setSpot({ ...spot, lat: null, lng: null }); setSaved(false); }} /> : null}
        <Text accessibilityRole="header" style={styles.heading}>Use a saved spot</Text>
        {!preferences.hydrated || pending ? <SkeletonRows testID="item.pickup.loading" /> : preferences.savedPickupSpots.length ? preferences.savedPickupSpots.map((entry, index) =>
          <AppButton key={`${entry.name}-${index}`} label={entry.name} accessibilityLabel={`Use saved spot ${entry.name}`}
            variant="outline" testID={`item.pickup.saved${index}`} onPress={() => { const { name: _name, ...value } = entry; setSpot(value); setSaved(false); }} />)
          : <Text style={styles.meta} testID="item.pickup.empty">No saved spots yet</Text>}
        <AppButton label={saved ? 'Spot saved' : 'Save this spot'} testID="item.pickup.saveSpot" variant="outline" disabled={pending || !valid || saved || !preferences.hydrated}
          onPress={() => void perform(async () => {
            const name = spot.place_name?.trim() || spot.note?.trim() || 'Pickup spot';
            await preferences.setSavedPickupSpots([...preferences.savedPickupSpots.filter((entry) => entry.name !== name), { ...spot, name }]);
            setSaved(true);
          })} />
        {pickup ? <AppButton label="Remove pickup spot" testID="item.pickup.remove" variant="outline" disabled={pending} onPress={() => void perform(() => save(null))} /> : null}
        {error ? <View testID="item.pickup.error" style={styles.sheet}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <AppButton label="Try again" testID="item.pickup.retry" onPress={() => { if (retry.current) void perform(retry.current); }} /></View> : null}
      </View>
    </ScrollView></SafeAreaView>
  </Modal>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground }, content: { flexGrow: 1, justifyContent: 'flex-end' },
    sheet: { gap: theme.spacing.md, padding: theme.spacing.gutter }, header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    title: { ...theme.type.sectionHeading, color: theme.colors.ink }, heading: { ...theme.type.cardHeading, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted }, body: { ...theme.type.body, color: theme.colors.inkSecondary },
    pin: { borderRadius: theme.radii.card, backgroundColor: theme.colors.track, padding: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm },
    error: { ...theme.type.body, color: theme.colors.urgentInk },
  });
}
