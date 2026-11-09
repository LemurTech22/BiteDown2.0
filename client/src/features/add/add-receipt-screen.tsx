import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { useApi } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { formatMoney, usePreferences } from '@/settings/preferences';
import { useTheme } from '@/theme';

import { AddScreen, addStyles } from './add-screen';
import { CameraDeniedCard } from './camera-denied-card';
import { draftError } from './candidate-editor';
import { CandidateReview, type ReviewDraft, reviewDrafts } from './candidate-review';
import { useCandidateSave } from './use-candidate-save';

export function AddReceiptScreen() {
  const { api } = useApi();
  const { currency } = usePreferences();
  const theme = useTheme();
  const styles = addStyles(theme);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [drafts, setDrafts] = useState<ReviewDraft[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [lastSource, setLastSource] = useState<'camera' | 'library'>('camera');
  const request = useRef(0);
  const pickerBusy = useRef(false);
  const { save, saving, saveError, setSaveError } = useCandidateSave();
  const selected = drafts?.filter((draft) => draft.selected) ?? [];
  const foodCount = drafts?.filter((draft) => !draft.nonFood).length ?? 0;
  useEffect(() => () => { request.current += 1; }, []);

  async function analyze(asset: ImagePicker.ImagePickerAsset) {
    const id = ++request.current;
    setPhoto(asset); setDrafts(null); setTotal(null); setError(''); setLoading(true); setSaveError('');
    try {
      const result = await api.fromReceipt({ uri: asset.uri, fileName: asset.fileName ?? undefined, mimeType: asset.mimeType ?? undefined });
      if (request.current === id) { setDrafts(reviewDrafts(result.candidates, 'receipt')); setTotal(result.total); }
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'We couldn’t analyze this receipt. Try again.');
    } finally {
      if (request.current === id) setLoading(false);
    }
  }

  async function pick(source: 'camera' | 'library') {
    if (pickerBusy.current || saving) return;
    pickerBusy.current = true; setPicking(true); setError(''); setLastSource(source);
    const id = request.current;
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setDenied(true); return; }
        setDenied(false);
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (request.current === id && !result.canceled && result.assets[0]) void analyze(result.assets[0]);
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'We couldn’t open your photos. Try again.');
    } finally {
      pickerBusy.current = false;
      if (request.current === id || request.current === id + 1) setPicking(false);
    }
  }

  function reset() {
    request.current += 1; setPhoto(null); setDrafts(null); setTotal(null); setLoading(false); setError(''); setSaveError('');
  }

  return <AddScreen title="Receipt review" screen="addReceipt">
    {!photo ? <View style={styles.section} testID="addReceipt.picker.empty">
      <Text style={styles.body}>Add a whole shop</Text>
      {denied ? <CameraDeniedCard screen="addReceipt" onRetry={() => void pick('camera')} /> : null}
      <AppButton label={denied ? 'Take a photo · Off' : 'Take a photo'} testID="addReceipt.camera.button" disabled={picking} onPress={() => void pick('camera')} />
      <AppButton label="Choose from library" testID="addReceipt.library.button" variant="outline" disabled={picking} onPress={() => void pick('library')} />
      {picking ? <SkeletonRows testID="addReceipt.picker.skeleton" /> : null}
    </View> : <Image source={{ uri: photo.uri }} accessibilityLabel="Your receipt photo" accessible testID="addReceipt.photo.preview"
      resizeMode="contain" style={{ width: '100%', height: theme.sizes.addHero, borderRadius: theme.radii.row }} />}
    {loading ? <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>Reading your receipt…</Text>
      <SkeletonRows testID="addReceipt.loading.skeleton" />
      <AppButton label="Cancel" testID="addReceipt.analysis.cancel" variant="outline" onPress={reset} />
    </> : null}
    {error ? <StateView icon="alert-circle-outline" title={photo ? 'Couldn’t analyze receipt' : 'Couldn’t open photo'} message={error}
      testID="addReceipt.analysis.error" actionLabel="Try again" actionTestID="addReceipt.analysis.retry"
      onAction={() => { if (photo) void analyze(photo); else void pick(lastSource); }} /> : null}
    {drafts?.length === 0 ? <StateView icon="receipt" title="No food to add" message="Try a closer, brighter receipt photo."
      testID="addReceipt.review.empty" actionLabel="Try again" actionTestID="addReceipt.empty.retry" onAction={reset} /> : null}
    {drafts && drafts.length > 0 ? <>
      <Text accessibilityRole="header" style={styles.heading}>{foodCount} food {foodCount === 1 ? 'item' : 'items'}</Text>
      <CandidateReview drafts={drafts} screen="addReceipt" receipt disabled={saving} onChange={(id, patch) => {
        setSaveError(''); setDrafts((current) => current?.map((draft) => draft.id === id ? { ...draft, ...patch } : draft) ?? null);
      }} />
      {total != null ? <Text style={styles.body} testID="addReceipt.total.label">Receipt total · {formatMoney(total, currency)}</Text> : null}
      {saveError ? <StateView icon="alert-circle-outline" title="Couldn’t save food" message={saveError} testID="addReceipt.save.error"
        actionLabel="Try again" actionTestID="addReceipt.save.retry" onAction={() => void save(selected)} /> : null}
      <AppButton label={`Add ${selected.length} ${selected.length === 1 ? 'item' : 'items'}`} testID="addReceipt.save.button"
        loading={saving} disabled={!selected.length || selected.some((draft) => Boolean(draftError(draft)))} onPress={() => void save(selected)} />
    </> : null}
    {photo && !loading ? <AppButton label="Choose another photo" testID="addReceipt.reset.button" variant="outline" disabled={saving} onPress={reset} /> : null}
  </AddScreen>;
}
