import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useApi, type FoodRequest } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useTheme } from '@/theme';

import { SocialError, SocialPage, socialStyles, TextAction } from './social-ui';
import { audienceLabel, hiddenAudienceLabel, requestAge } from './social-utils';
import { errorMessage, useSocialData } from './use-social-data';

export function MyRequestsScreen() {
  const { api } = useApi();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const state = useSocialData(useCallback(async () => (await api.getRequests({ mine: true })).requests, [api]));
  const { updateData } = state;
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const busy = useRef(false);
  const handleCancel = useCallback(async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(id);
    setFailed(null);
    try {
      const { request } = await api.deleteRequest(id);
      updateData((notes) => notes.map((note) => note.id === id ? request : note));
    } catch (cause) {
      reportServerError(cause);
      setFailed({ id, message: errorMessage(cause) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      busy.current = false;
      setPending(null);
    }
  }, [api, updateData]);
  const open = state.data?.filter((note) => note.status === 'open') ?? [];
  const done = state.data?.filter((note) => note.status === 'fulfilled') ?? [];
  return <SocialPage title="Your requests" screen="myRequests">
    {state.status === 'loading' ? <SkeletonRows testID="myRequests.loading.skeleton" /> : null}
    {state.status === 'error' ? <SocialError screen="myRequests" message={state.error} onRetry={() => void state.reload()} /> : null}
    {failed ? <SocialError screen="myRequests.cancel" message={failed.message} onRetry={() => void handleCancel(failed.id)} /> : null}
    {pending ? <SkeletonRows testID="myRequests.cancel.skeleton" /> : null}
    {state.status === 'ready' && !open.length && !done.length ? <StateView icon="note-outline" title="No requests yet"
      message="Ask your friends and groups for something you need." testID="myRequests.empty.state"
      actionLabel="Ask for something" actionTestID="myRequests.empty.ask" onAction={() => router.push('/social/request-new')} /> : null}
    {state.status === 'ready' ? [{ title: 'Open', notes: open }, { title: 'Done', notes: done }].filter((section) => section.notes.length).map((section) =>
      <View key={section.title} style={styles.section}>
        <Text accessibilityRole="header" style={styles.meta}>{section.title} · {section.notes.length}</Text>
        {section.notes.map((note) => <MyRequestCard key={note.id} note={note} pending={pending}
          onCancel={handleCancel} />)}
      </View>) : null}
  </SocialPage>;
}

function MyRequestCard({ note, pending, onCancel }: {
  note: FoodRequest; pending: string | null; onCancel: (id: string) => Promise<void>;
}) {
  const theme = useTheme();
  const styles = socialStyles(theme);
  return <View testID={`myRequests.note.${note.id}`} style={[styles.note, note.status === 'fulfilled' && styles.noteLime]}>
    <Text style={styles.heading}>{note.text}</Text>
    <Text style={styles.meta}>{[audienceLabel(note), requestAge(note.created_at)].filter(Boolean).join(' · ')}</Text>
    {note.audiences.hidden_count > 0 ? <Text style={styles.meta}>{hiddenAudienceLabel(note.audiences.hidden_count)}</Text> : null}
    {note.status === 'open' ? <View style={styles.row}><TextAction label={pending === note.id ? 'Cancelling…' : 'Cancel'} danger
      accessibilityLabel={`Cancel request: ${note.text}`} testID={`myRequests.cancel.${note.id}`}
      disabled={pending !== null} onPress={() => void onCancel(note.id)} /></View> :
      <View style={[styles.row, styles.badge]}><AppIcon name="check" color={theme.colors.forest} />
        <Text style={styles.badgeText}>{note.fulfilled_by_name ? `Fulfilled by ${note.fulfilled_by_name}` : 'Fulfilled'}</Text></View>}
  </View>;
}
