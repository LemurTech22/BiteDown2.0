import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

import { CandidateEditor, type CandidateDraft, draftError, toCreateItem } from './candidate-editor';
import { ChoiceControl } from './choice-control';

type Photo = { asset: ImagePicker.ImagePickerAsset; mode: 'fridge' | 'single' };

export function AddPhotoScreen() {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [mode, setMode] = useState<Photo['mode']>('fridge');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [lastSource, setLastSource] = useState<'camera' | 'library'>('camera');
  const pickerBusy = useRef(false);

  async function pick(source: 'camera' | 'library') {
    if (pickerBusy.current) return;
    pickerBusy.current = true;
    setPicking(true);
    setError('');
    setDenied(false);
    setLastSource(source);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setDenied(true);
          setError('Camera access is off. Allow camera access in Settings, or choose a photo from your library.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) :
        await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) setPhoto({ asset: result.assets[0], mode });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We couldn’t open your photos. Try again.');
    } finally {
      pickerBusy.current = false;
      setPicking(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>{photo ? 'Review photo' : 'Add food'}</Text>
          <IconButton icon="close" label="Close add food" onPress={() => router.back()} testID="add.close.button" />
        </View>
        {photo ? <PhotoReview photo={photo} onReset={() => setPhoto(null)} /> : (
          <FadeIn style={styles.section} testID="add.empty.state">
            <View style={styles.hero}>
              <AppIcon name="camera-outline" color={theme.colors.onForest} size={theme.sizes.addHeroGlyph} />
              <Text style={styles.heroTitle}>Snap a photo</Text>
              <Text style={styles.heroText}>Your whole fridge, or just one item</Text>
            </View>
            <ChoiceControl label="Photo mode" value={mode} onChange={setMode} disabled={picking}
              options={[{ value: 'fridge', label: 'Whole fridge' }, { value: 'single', label: 'One item' }]} testID="add.mode" />
            <AppButton label="Take a photo" testID="add.camera.button" onPress={() => void pick('camera')} disabled={picking} />
            <AppButton label="Choose from library" testID="add.library.button" onPress={() => void pick('library')}
              variant="outline" disabled={picking} />
            {picking ? <SkeletonRows testID="add.picker.skeleton" /> : null}
            {error ? <StateView icon="camera-off" title={denied ? 'Camera access is off' : 'Couldn’t open photo'}
              message={error} testID="add.picker.error" actionLabel="Try again" actionTestID="add.picker.retry"
              onAction={() => void pick(lastSource)} /> : null}
            {denied ? <AppButton label="Open Settings" testID="add.settings.button" variant="outline"
              onPress={() => void Linking.openSettings().catch(() => setError('Open your device Settings to allow camera access.'))} /> : null}
          </FadeIn>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PhotoReview({ photo, onReset }: { photo: Photo; onReset: () => void }) {
  const { api } = useApi();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const styles = createStyles(theme);
  const [attempt, setAttempt] = useState(0);
  const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const saveBusy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void api.fromPhoto({ uri: photo.asset.uri, fileName: photo.asset.fileName ?? undefined,
      mimeType: photo.asset.mimeType ?? undefined, mode: photo.mode, enrich: ['expiry'] }).then((result) => {
      if (active) setDrafts(result.candidates.map((candidate, id) => ({ id, candidate, name: candidate.name,
        quantity: String(candidate.quantity), storage: candidate.storage, expiry: candidate.predicted_expiry })));
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'We couldn’t analyze this photo. Try again.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, attempt, photo]);

  async function save() {
    if (saveBusy.current || !drafts.length || drafts.some(draftError)) return;
    saveBusy.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await api.createItems({ items: drafts.map((draft) => toCreateItem(draft, photo.mode)) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (mounted.current) router.back();
    } catch (cause) {
      if (mounted.current) setSaveError(cause instanceof Error ? cause.message : 'We couldn’t save your food. Try again.');
    } finally {
      saveBusy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <View style={styles.section}>
      <Image source={{ uri: photo.asset.uri }} accessibilityLabel="Your food photo" accessible
        style={[styles.preview, { aspectRatio: photo.asset.width > 0 && photo.asset.height > 0 ? photo.asset.width / photo.asset.height : 1 }]}
        resizeMode="contain" testID="add.photo.preview" />
      {loading ? <FadeIn style={styles.section} testID="add.loading.state">
        <ActivityIndicator color={theme.colors.forest} accessibilityLabel="Analyzing photo"
          animating={!reducedMotion} hidesWhenStopped={false} />
        <Text accessibilityLiveRegion="polite" style={styles.body}>Finding your food and predicting expiry… This can take up to 75 seconds.</Text>
        <SkeletonRows testID="add.loading.skeleton" />
      </FadeIn> : error ? <StateView icon="alert-circle-outline" title="Couldn’t analyze photo" message={error}
        testID="add.analysis.error" actionLabel="Try again" actionTestID="add.analysis.retry"
        onAction={() => { setLoading(true); setError(''); setAttempt((value) => value + 1); }} /> :
        !drafts.length ? <StateView icon="food-apple-outline" title="No food to add"
          message="Try a closer, brighter photo. You can also choose another photo." testID="add.review.empty"
          actionLabel="Choose another photo" actionTestID="add.empty.retry" onAction={onReset} /> : (
          <>
            <Text accessibilityRole="header" style={styles.title}>We found {drafts.length} {drafts.length === 1 ? 'item' : 'items'}</Text>
            <Text style={styles.body}>Check each item before adding. Expiry dates are estimates.</Text>
            {drafts.map((draft, index) => <FadeIn key={draft.id} delay={reducedMotion ? 0 : Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.staggerMs}>
              <CandidateEditor draft={draft} disabled={saving}
                onChange={(patch) => { setSaveError(''); setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, ...patch } : item)); }}
                onDrop={() => { setSaveError(''); setDrafts((current) => current.filter((item) => item.id !== draft.id)); }} />
            </FadeIn>)}
            {saveError ? <StateView icon="alert-circle-outline" title="Couldn’t save food" message={saveError}
              testID="add.save.error" actionLabel="Try again" actionTestID="add.save.retry" onAction={() => void save()} /> : null}
            <AppButton label={`Add ${drafts.length} ${drafts.length === 1 ? 'item' : 'items'}`} testID="add.save.button"
              loading={saving} disabled={drafts.some((draft) => Boolean(draftError(draft)))} onPress={() => void save()} />
          </>
        )}
      <AppButton label={loading ? 'Cancel analysis' : 'Choose another photo'} variant="outline"
        testID="add.reset.button" onPress={onReset} disabled={saving} />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, padding: theme.spacing.gutter, gap: theme.spacing.xl },
    section: { gap: theme.spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, justifyContent: 'space-between' },
    title: { ...theme.type.sheetTitle, color: theme.colors.ink, flexShrink: 1 },
    body: { ...theme.type.bodySmall, color: theme.colors.muted },
    hero: { backgroundColor: theme.colors.forest, borderRadius: theme.radii.hero, padding: theme.spacing.lg, gap: theme.spacing.sm, minHeight: theme.sizes.addHero },
    heroTitle: { ...theme.type.sectionHeading, color: theme.colors.onForest },
    heroText: { ...theme.type.bodySmall, color: theme.colors.onForestMuted },
    preview: { width: '100%', borderRadius: theme.radii.row, backgroundColor: theme.colors.track },
  });
}
