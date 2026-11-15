import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { isApiError, useApi } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useTheme } from '@/theme';

import { AddScreen, addStyles } from './add-screen';
import { CameraDeniedCard } from './camera-denied-card';
import { draftError, needsSpoiledDecision } from './candidate-editor';
import { CandidateReview, type ReviewDraft, reviewDrafts } from './candidate-review';
import { useCandidateSave } from './use-candidate-save';

export function AddBarcodeScreen() {
  const { api } = useApi();
  const [permission, requestPermission] = useCameraPermissions();
  const theme = useTheme();
  const styles = addStyles(theme);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const lastCode = useRef('');
  const scanBusy = useRef(false);
  const request = useRef(0);
  const { save, saving, saveError, setSaveError } = useCandidateSave();
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); }; }, []));
  useEffect(() => () => { request.current += 1; }, []);

  async function allowCamera() {
    try { await requestPermission(); setError(''); }
    catch { setError('We couldn’t open the camera. Try again.'); }
  }

  async function lookup(code: string) {
    if (scanBusy.current || !/^\d{6,14}$/.test(code)) return;
    scanBusy.current = true;
    const id = ++request.current;
    lastCode.current = code;
    setLoading(true); setError(''); setNotFound(false); setDraft(null); setSaveError('');
    try {
      const result = await api.getBarcode(code);
      if (request.current === id) setDraft(reviewDrafts([result.candidate], 'barcode')[0]);
    } catch (cause) {
      if (request.current === id) {
        if (isApiError(cause) && cause.status === 404) setNotFound(true);
        else setError(cause instanceof Error ? cause.message : 'We couldn’t look up this barcode. Try again.');
      }
    } finally {
      if (request.current === id) { scanBusy.current = false; setLoading(false); }
    }
  }

  function scanAgain() {
    request.current += 1; scanBusy.current = false;
    setDraft(null); setLoading(false); setError(''); setNotFound(false); setSaveError('');
  }

  return <AddScreen title="Scan a barcode" screen="addBarcode" footer={draft ?
    <AppButton label={`Add ${draft.selected ? 1 : 0}`} testID="addBarcode.save.button" loading={saving}
      disabled={!draft.selected || needsSpoiledDecision(draft) || Boolean(draftError(draft))} onPress={() => void save([draft])} /> : null}>
    <AppButton label="Type it instead" testID="add.barcode.manual.button" variant="outline" disabled={saving} onPress={() => router.replace('/add-text')} />
    {!permission ? <SkeletonRows testID="addBarcode.permission.skeleton" /> :
      !permission.granted ? permission.status === 'denied' || !permission.canAskAgain ?
        <CameraDeniedCard screen="addBarcode" onRetry={() => void allowCamera()} /> :
        <AppButton label="Allow camera access" testID="addBarcode.permission.button" onPress={() => void allowCamera()} /> : null}
    {permission?.granted && focused && !draft && !loading && !error && !notFound ? <>
      <View style={{ height: theme.sizes.addHero * 3, borderRadius: theme.radii.card, overflow: 'hidden' }}>
        <CameraView testID="addBarcode.camera.scanner" accessibilityLabel="Barcode scanner" style={{ flex: 1 }} facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
          onBarcodeScanned={({ data }) => void lookup(data)}
          onMountError={() => setError('We couldn’t open the camera. Try again.')} />
      </View>
      <Text style={styles.body}>Hold the barcode inside the camera view.</Text>
    </> : null}
    {loading ? <><Text accessibilityLiveRegion="polite" style={styles.body}>Finding your item…</Text><SkeletonRows testID="addBarcode.loading.skeleton" /></> : null}
    {notFound ? <StateView icon="barcode-off" title="Barcode not found" message="Type your food to add it instead."
      testID="addBarcode.lookup.empty" actionLabel="Type it" actionTestID="addBarcode.empty.type" onAction={() => router.replace('/add-text')} /> : null}
    {error ? <StateView icon="alert-circle-outline" title="Couldn’t scan barcode" message={error}
      testID="addBarcode.lookup.error" actionLabel="Try again" actionTestID="addBarcode.lookup.retry"
      onAction={() => { if (lastCode.current) void lookup(lastCode.current); else if (permission?.granted) scanAgain(); else void allowCamera(); }} /> : null}
    {draft ? <>
      <Text style={styles.body}>Found on Open Food Facts</Text>
      <CandidateReview drafts={[draft]} screen="addBarcode" disabled={saving}
        onChange={(_id, patch) => { setDraft({ ...draft, ...patch }); setSaveError(''); }} />
      {saveError ? <StateView icon="alert-circle-outline" title="Couldn’t save food" message={saveError} testID="addBarcode.save.error"
        actionLabel="Try again" actionTestID="addBarcode.save.retry" onAction={() => void save([draft])} /> : null}
    </> : null}
    {loading || draft || notFound || error ? <AppButton label={loading ? 'Cancel' : 'Scan another barcode'} variant="outline"
      testID="addBarcode.reset.button" disabled={saving} onPress={scanAgain} /> : null}
  </AddScreen>;
}
