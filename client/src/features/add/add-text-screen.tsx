import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, type TextInputInstance, View } from 'react-native';

import { useApi } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useTheme } from '@/theme';

import { AddScreen, addStyles } from './add-screen';
import { draftError } from './candidate-editor';
import { CandidateReview, type ReviewDraft, reviewDrafts } from './candidate-review';
import { useCandidateSave } from './use-candidate-save';

export function AddTextScreen() {
  const { api } = useApi();
  const { mode, group_id: groupId } = useLocalSearchParams<{ mode?: string; group_id?: string }>();
  const theme = useTheme();
  const styles = addStyles(theme);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<ReviewDraft[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const busy = useRef(false);
  const input = useRef<TextInputInstance>(null);
  const { save, saving, saveError, setSaveError } = useCandidateSave(groupId);
  const selected = drafts?.filter((draft) => draft.selected) ?? [];
  useEffect(() => { if (mode === 'voice') input.current?.focus(); }, [mode]);
  useEffect(() => () => { request.current += 1; }, []);

  async function parse() {
    if (busy.current || saving || !text.trim()) return;
    busy.current = true;
    const id = ++request.current;
    setLoading(true); setError(''); setSaveError(''); setDrafts(null);
    try {
      const result = await api.parseText({ text: text.trim() });
      if (request.current === id) setDrafts(reviewDrafts(result.candidates, 'text'));
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : 'We couldn’t understand that. Try again.');
    } finally {
      if (request.current === id) { busy.current = false; setLoading(false); }
    }
  }

  return <AddScreen title="Type or say it" screen="addText" footer={drafts && drafts.length > 0 ?
    <AppButton label={`Add ${selected.length} ${selected.length === 1 ? 'item' : 'items'}`} testID="addText.save.button" loading={saving}
      disabled={!selected.length || selected.some((draft) => Boolean(draftError(draft)))} onPress={() => void save(selected)} /> : null}>
    <View style={styles.section}>
      <Text style={styles.label}>What did you get?</Text>
      <TextInput ref={input} multiline accessibilityLabel="What did you get?" testID="addText.input.text"
        style={[styles.input, styles.multiline]} placeholder="2 lb chicken, milk" placeholderTextColor={theme.colors.muted}
        selectionColor={theme.colors.forest} maxLength={4000} value={text} editable={!loading && !saving}
        onChangeText={(value) => { setText(value); setDrafts(null); setError(''); setSaveError(''); }} />
      {mode === 'voice' ? <Text testID="addText.voice.hint" style={styles.body}>Use the microphone on your keyboard to say what you got.</Text> : null}
      <AppButton label="Review items" testID="addText.parse.button" onPress={() => void parse()}
        disabled={!text.trim() || saving || loading} />
    </View>
    {loading ? <><Text accessibilityLiveRegion="polite" style={styles.body}>Finding your food…</Text><SkeletonRows testID="addText.loading.skeleton" /></> : null}
    {error ? <StateView icon="alert-circle-outline" title="Couldn’t understand your food" message={error}
      testID="addText.parse.error" actionLabel="Try again" actionTestID="addText.parse.retry" onAction={() => void parse()} /> : null}
    {drafts?.length === 0 ? <StateView icon="food-apple-outline" title="No food to add" message="Try adding a food name and quantity."
      testID="addText.review.empty" actionLabel="Try again" actionTestID="addText.empty.retry" onAction={() => input.current?.focus()} /> : null}
    {drafts && drafts.length > 0 ? <>
      <Text accessibilityRole="header" style={styles.heading}>We understood {drafts.length} {drafts.length === 1 ? 'item' : 'items'}</Text>
      <CandidateReview drafts={drafts} screen="addText" disabled={saving} onChange={(id, patch) => {
        setSaveError(''); setDrafts((current) => current?.map((draft) => draft.id === id ? { ...draft, ...patch } : draft) ?? null);
      }} />
      {saveError ? <StateView icon="alert-circle-outline" title="Couldn’t save food" message={saveError} testID="addText.save.error"
        actionLabel="Try again" actionTestID="addText.save.retry" onAction={() => void save(selected)} /> : null}
    </> : null}
  </AddScreen>;
}
