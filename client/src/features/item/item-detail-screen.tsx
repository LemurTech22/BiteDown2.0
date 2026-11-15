import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type Item, type PickupSpot, type UpdateItemInput } from '@/api';
import { useNotice } from '@/components/notice/notice';
import { ItemThumb } from '@/components/ui/item-thumb';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { FoodEditSheet, FoodSummary, type FoodField } from '@/components/ui/food-summary';
import { FadeIn } from '@/components/ui/fade-in';
import { ExpiryBadge } from '@/features/fridge/expiry-badge';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { UndoToast } from '@/features/remove/undo-toast';
import { useRemovalUndo } from '@/features/remove/use-removal-undo';
import { mapsUrl } from '@/features/social/maps-url';
import { formatMoney, formatWeight, usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

import { PickupSheet } from './pickup-sheet';
import { SPOILAGE_SIGNS } from './spoilage-signs';

export function ItemDetailScreen() {
  const { id: param } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(param) ? param[0] : param;
  const { api } = useApi();
  const notice = useNotice();
  const { units, currency } = usePreferences();
  const theme = useTheme();
  const styles = createStyles(theme);
  const [item, setItem] = useState<Item | null>(null);
  const [editing, setEditing] = useState<FoodField | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [removing, setRemoving] = useState<'normal' | 'given' | null>(null);
  const request = useRef(0);
  const working = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const { entries, remember, undo, dismiss } = useRemovalUndo((restored) => { setItem(restored); });
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setLoadError('');
    try {
      const response = await api.getItems({ include_removed: true });
      if (version !== request.current) return;
      const items = 'items' in response ? response.items : response.sections.flatMap((section) => section.items);
      const found = items.find((candidate) => candidate.id === id) ?? null;
      setItem(found);
    } catch (cause) { if (version === request.current) setLoadError(cause instanceof Error ? cause.message : 'Couldn’t load this item. Try again.'); }
    finally { if (version === request.current) setLoading(false); }
  }, [api, id]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; request.current += 1; };
  }, [load]);

  // One number per visit: it changes when this screen shows another item (even A -> B -> A) and on unmount. A save
  // started on an earlier visit must not touch state, haptics, notices or the open sheet when it settles (CL-17..19).
  const visit = useRef(0);
  useEffect(() => {
    visit.current += 1;
    return () => { visit.current += 1; };
  }, [id]);
  async function perform(action: () => Promise<void>) {
    if (working.current) return;
    const started = visit.current;
    working.current = true; retry.current = action; setPending(true); setError('');
    try { await action(); }
    catch (cause) {
      if (visit.current !== started) return;  // failed after the user left this visit: no stale error or haptic (CL-19)
      setError(cause instanceof Error ? cause.message : 'Couldn’t update this item. Try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally { working.current = false; setPending(false); }
  }
  async function saveChanges(patch: UpdateItemInput) {
    if (!item || item.removed_at) return;
    const changes = { ...patch };
    // Reconfirming an estimate must not turn it into a user-entered date.
    if (changes.predicted_expiry === item.predicted_expiry) delete changes.predicted_expiry;
    if (changes.freshness === item.freshness) delete changes.freshness;
    const started = visit.current;
    try {
      const { item: updated } = await api.updateItem(item.id, changes);
      if (visit.current !== started) return;  // saved on the server, but the user left this visit (CL-17, CL-18)
      setItem(updated);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      notice.show(`Saved changes to ${updated.name}`);
    } catch (cause) {
      if (visit.current !== started) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      throw cause;
    }
  }
  async function toggleShare() {
    if (!item) return;
    if (item.share?.status === 'open') {
      await api.deleteShare(item.share.id);
      setItem({ ...item, share: null });
    } else {
      const { listing } = await api.createShare({ item_id: item.id });
      setItem({ ...item, share: { id: listing.id, status: 'open', audience: { friends: true, groups: [] }, claimed_by: null, pickup: listing.pickup, pickup_set: listing.pickup_set } });
    }
  }
  async function savePickup(pickup: PickupSpot | null) {
    if (!item?.share) return;
    const { listing } = await api.updateShare(item.share.id, { pickup });
    setItem({ ...item, share: { ...item.share, pickup: listing.pickup, pickup_set: listing.pickup_set } });
  }
  async function analyze(asset: ImagePicker.ImagePickerAsset) {
    if (!item) return;
    const { candidates } = await api.fromPhoto({ uri: asset.uri, fileName: asset.fileName ?? undefined, mimeType: asset.mimeType ?? undefined, mode: 'single' });
    const freshness = candidates[0]?.freshness;
    if (!freshness) throw new Error('We couldn’t assess freshness. Try another photo.');
    const { item: updated } = await api.updateItem(item.id, { freshness });
    setItem(updated); setPhotoOpen(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }
  async function pickPhoto(camera: boolean) {
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new Error('Camera access is off. Choose a photo or enable access in Settings.');
    }
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    retry.current = () => analyze(asset);
    await analyze(asset);
  }

  const share = item?.share?.status === 'open' ? item.share : null;
  const claimer = share?.claimed_by;
  const pickup = share?.pickup;
  return <SafeAreaView style={styles.screen} edges={['top']} testID="item.screen.root">
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
      <View style={styles.header}><AppButton label="Back" variant="outline" testID="item.back.button" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/fridge'); }} />
        <Text accessibilityRole="header" style={styles.title}>Item detail</Text>
</View>
      {loading ? <SkeletonRows testID="item.loading.skeleton" /> : loadError ? <StateView title="Couldn’t load item" message={loadError} icon="cloud-off-outline" testID="item.error.state"
        actionLabel="Try again" actionTestID="item.error.retry" onAction={() => void load()} /> : !item ? <StateView title="Item not found" message="This item is no longer available."
        icon="fridge-outline" testID="item.empty.state" actionLabel="Try again" actionTestID="item.empty.retry" onAction={() => void load()} /> : item.removed_at ? <>
          <Text style={styles.body} testID="item.removed.state">{item.name} removed</Text>
          {entries.map((entry) => <UndoToast key={entry.item.id} entry={entry} onUndo={() => void undo(entry)} onDismiss={() => dismiss(entry.item.id)} />)}
        </> : <>
        <View style={styles.card}>
          <View style={styles.hero}>
            <ItemThumb name={item.name} foodGroup={item.food_group} photoUrl={item.photo_url} size={theme.sizes.itemDetailThumb} />
            <FadeIn key={`${item.name}-${item.quantity}-${item.unit}`} style={styles.heroCopy}><Text accessibilityRole="header" style={styles.heading}>{item.name}</Text>
              <Text style={styles.body}>{item.quantity} {item.unit === 'piece' && item.quantity !== 1 ? 'pieces' : item.unit}</Text></FadeIn>
          </View>
          <FoodSummary values={item} estimated={item.expiry_source !== 'user'} testID="item" disabled={pending} onEdit={(field) => { setError(''); setEditing(field); }} />
          <ExpiryBadge item={item} testID="item.status.badge" />
          {item.est_weight_kg !== null ? <Text style={styles.meta}>Estimated weight: {formatWeight(item.est_weight_kg, units)}</Text> : null}
          {item.est_price !== null ? <Text style={styles.meta}>Estimated value: {formatMoney(item.est_price, currency)}</Text> : null}
        </View>
        <AppButton label="Check again" testID="item.photo.button" variant="outline" disabled={pending} onPress={() => setPhotoOpen((current) => !current)} />
        {photoOpen ? <View style={styles.card} testID="item.photo.chooser">
          <AppButton label="Take photo" testID="item.photo.camera" disabled={pending} onPress={() => void perform(() => pickPhoto(true))} />
          <AppButton label="Choose photo" testID="item.photo.library" variant="outline" disabled={pending} onPress={() => void perform(() => pickPhoto(false))} />
          <AppButton label="Cancel" testID="item.photo.cancel" variant="outline" disabled={pending} onPress={() => setPhotoOpen(false)} />
        </View> : null}
        <View style={styles.section}><Text accessibilityRole="header" style={styles.heading}>What to look for</Text>
          {SPOILAGE_SIGNS[item.food_group].map((sign) => <Text key={sign} style={styles.body}>• {sign}</Text>)}
          <Text style={styles.meta}>These are signs, not a safety guarantee.</Text></View>
        {!item.group_id ? <View style={styles.card}>
          <View style={styles.header}><Text accessibilityRole="header" style={styles.heading}>{claimer ? 'Shared with friends' : 'Share with friends'}</Text>
            {!claimer ? <View style={styles.switchTarget}><Switch accessibilityLabel="Share with friends" testID="item.share.toggle" value={Boolean(share)} disabled={pending}
              onValueChange={() => void perform(toggleShare)} trackColor={{ false: theme.colors.track, true: theme.colors.forest }} thumbColor={theme.colors.surface} /></View> : null}</View>
          {share ? <><Text style={styles.body}>{claimer ? 'Shared with' : 'Visible to:'} {[(share.audience.friends ? 'Friends' : ''), ...share.audience.groups.map((group) => group.name)].filter(Boolean).join(', ')}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.chip} testID="item.share.status">{claimer ? `Claimed by ${claimer.name}` : 'Not claimed yet'}</Text>
            <Text accessibilityRole="header" style={styles.label}>Pickup spot</Text>
            {pickup ? <>
              {pickup.lat !== null && pickup.lng !== null ? <View accessible accessibilityLabel={`Pickup pin at ${pickup.place_name || `${pickup.lat}, ${pickup.lng}`}`} style={styles.pin}><AppIcon name="map-marker" color={theme.colors.forest} /></View> : null}
              {pickup.place_name ? <Text style={styles.label}>{pickup.place_name}</Text> : null}{pickup.note ? <Text style={styles.body}>{pickup.note}</Text> : null}
              <AppButton label="Edit" accessibilityLabel="Edit pickup spot" testID="item.pickup.edit" variant="outline" disabled={pending} onPress={() => setPickupOpen(true)} />
              {pickup.lat !== null && pickup.lng !== null ? <AppButton label="Open in Maps" testID="item.pickup.maps" variant="outline" onPress={() => void perform(async () => {
                if (pickup.lat === null || pickup.lng === null) return;
                await Linking.openURL(mapsUrl({ lat: pickup.lat, lng: pickup.lng, label: pickup.place_name || 'Pickup spot' }));
              })} /> : null}
            </> : <AppButton label="Add a pickup spot" testID="item.pickup.add" variant="outline" disabled={pending} onPress={() => setPickupOpen(true)} />}
          </> : null}
        </View> : null}
        {pending ? <SkeletonRows testID="item.mutation.loading" /> : null}
        {error ? <View style={styles.section} testID="item.mutation.error"><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <AppButton label="Try again" testID="item.mutation.retry" disabled={pending} onPress={() => { if (retry.current) void perform(retry.current); }} /></View> : null}
        {claimer ? <AppButton label={`Given to ${claimer.name}`} testID="item.given.button" disabled={pending} onPress={() => setRemoving('given')} /> : null}
        <AppButton label="Remove" accessibilityLabel="Remove: choose what happened" testID="item.remove.button" variant={claimer ? 'outline' : 'primary'} disabled={pending} onPress={() => setRemoving('normal')} />
        {claimer ? <AppButton label="Stop sharing" testID="item.share.stop" variant="outline" disabled={pending} onPress={() => void perform(toggleShare)} /> : null}
      </>}
    </ScrollView>
    {item && !item.removed_at && editing ? <FoodEditSheet key={editing} field={editing} values={item}
      estimated={item.expiry_source !== 'user'} storageExpirySource={item.expiry_source} testID="item.edit"
      onSave={saveChanges} onClose={() => setEditing(null)} /> : null}
    {item && removing ? <RemoveSheet key={`${item.id}-${removing}`} item={item} units={units} initialShared={removing === 'given'} onClose={() => setRemoving(null)} onRemoved={(removed) => { setItem(removed); remember(removed); }} /> : null}
    {pickupOpen ? <PickupSheet pickup={pickup ?? null} onSave={savePickup} onClose={() => setPickupOpen(false)} /> : null}
  </SafeAreaView>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground }, content: { padding: theme.spacing.gutter, gap: theme.spacing.lg, flexGrow: 1 },
    header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
    title: { ...theme.type.sectionHeading, color: theme.colors.ink }, heading: { ...theme.type.cardHeading, color: theme.colors.ink },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, padding: theme.spacing.lg, gap: theme.spacing.md },
    hero: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }, heroCopy: { flex: 1, gap: theme.spacing.sm },
    section: { gap: theme.spacing.sm }, label: { ...theme.type.formLabel, color: theme.colors.inkSecondary }, body: { ...theme.type.bodySmall, color: theme.colors.inkSecondary },
    meta: { ...theme.type.meta, color: theme.colors.muted }, error: { ...theme.type.body, color: theme.colors.urgentInk },
    chip: { ...theme.type.badge, color: theme.colors.forest, backgroundColor: theme.colors.limeTint, borderRadius: theme.radii.chip, padding: theme.spacing.sm, alignSelf: 'flex-start' },
    switchTarget: { minHeight: theme.sizes.touchTarget, minWidth: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    pin: { minHeight: theme.sizes.emptyIcon, padding: theme.spacing.lg, backgroundColor: theme.colors.track, borderRadius: theme.radii.input, alignItems: 'center', justifyContent: 'center' },
  });
}
