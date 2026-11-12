import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type FoodRequest, type GroupDetail, type Item } from '@/api';
import { useAuth } from '@/auth/auth-provider';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { CodeQr, connectStyles, Toggle } from '@/features/connect/connect-ui';
import { GroupPantryRow } from '@/features/connect/group-pantry-row';
import { colors, useTheme } from '@/theme';

export function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useApi();
  const { user } = useAuth();
  const theme = useTheme();
  const styles = connectStyles(theme);
  const [data, setData] = useState<{ group: GroupDetail; items: Item[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState<{ action: 'leave' | 'share'; message: string } | null>(null);
  const [tab, setTab] = useState<'pantry' | 'requests'>('pantry');
  const [requests, setRequests] = useState<FoodRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const sequence = useRef(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const [{ group }, { items }] = await Promise.all([api.getGroup(id), api.getGroupPantry(id)]);
      if (request === sequence.current) setData({ group, items });
    } catch (cause) {
      reportServerError(cause);
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [api, id]);

  useFocusEffect(useCallback(() => {
    setQrOpen(false); setConfirm(false); setRequests(null); setTab('pantry');
    void load();
    return () => { sequence.current += 1; };
  }, [load]));

  async function loadRequests() {
    setRequests(null); setRequestsError(null);
    try {
      const result = await api.getRequests();
      setRequests(result.requests.filter((request) => request.audiences.groups.some((group) => group.id === id)));
    } catch (cause) {
      reportServerError(cause);
      setRequestsError(cause instanceof Error ? cause.message : 'Please try again.');
    }
  }

  async function shareInvite() {
    if (!data) return;
    setActionError(null);
    try {
      await Share.share({ message: `Join ${data.group.name} on BiteDown: bitedown://group/${data.group.invite_code}` });
    } catch {
      setActionError({ action: 'share', message: 'Couldn’t share the invite. Try again.' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  async function leave() {
    if (submitting.current) return;
    submitting.current = true; setLeaving(true); setActionError(null);
    try {
      await api.leaveGroup(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.dismissTo('/social/connect');
    } catch (cause) {
      reportServerError(cause);
      setActionError({ action: 'leave', message: cause instanceof Error ? cause.message : 'Couldn’t leave the group. Try again.' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      submitting.current = false; setLeaving(false);
    }
  }

  const inviteCode = data?.group.invite_code.replace(/^(.{4})(.{4})$/, '$1-$2');
  const joinedAt = data?.group.members.find((member) => member.user_id === user?.id)?.joined_at;
  const joinedDate = joinedAt ? new Date(joinedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: theme.spacing.xxl }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back to friends and groups" testID="groupDetail.back.button" onPress={() => router.back()} />
        <Text accessibilityRole="header" style={styles.title}>{data?.group.name ?? 'Group'}</Text>
      </View>
      {loading ? <SkeletonRows testID="groupDetail.loading.skeleton" /> : error ? <StateView icon="cloud-off-outline"
        title="Couldn’t load this group" message={error} testID="groupDetail.error.state" actionLabel="Try again"
        actionTestID="groupDetail.error.retry" onAction={() => void load()} /> : data ? <>
        <Text style={styles.meta}>{data.group.member_count} {data.group.member_count === 1 ? 'member' : 'members'}{joinedDate ? ` · you joined ${joinedDate}` : ''}</Text>
        <View style={styles.row} accessibilityRole="tablist">
          {(['pantry', 'requests'] as const).map((value) => <Pressable key={value} accessibilityRole="tab"
            accessibilityLabel={value === 'pantry' ? 'Group pantry' : 'Requests'} accessibilityState={{ selected: tab === value }}
            testID={`groupDetail.tab.${value}`} style={[styles.toggle, { flexGrow: 1 }, tab === value && { backgroundColor: theme.colors.limeTint }]}
            onPress={() => { setTab(value); if (value === 'requests') void loadRequests(); }}>
            <Text style={styles.name}>{value === 'pantry' ? 'Group pantry' : 'Requests'}</Text>
          </Pressable>)}
        </View>
        {tab === 'pantry' ? <>
          {data.items.length === 0 ? <StateView icon="food-apple-outline" title="Nothing in the group pantry yet"
            message="" testID="groupDetail.pantry.empty" /> : data.items.map((item) => <GroupPantryRow item={item} currentUserId={user?.id} key={item.id} />)}
          <AppButton label="+ Add to group pantry" testID="groupDetail.pantry.add"
            onPress={() => router.push({ pathname: '/add-text', params: { group_id: id } })} />
        </> : requestsError ? <StateView icon="cloud-off-outline" title="Couldn’t load requests" message={requestsError}
          testID="groupDetail.requests.error" actionLabel="Try again" actionTestID="groupDetail.requests.retry" onAction={() => void loadRequests()} /> :
          !requests ? <SkeletonRows testID="groupDetail.requests.loading" /> : requests.length === 0 ? <StateView
            icon="note-text-outline" title="No requests yet" message="" testID="groupDetail.requests.empty" /> : requests.map((request) =>
              <View key={request.id} style={styles.card} testID={`groupDetail.request.${request.id}`}>
                <Text style={styles.body}>{request.text}</Text><Text style={styles.meta}>{request.author_name}</Text>
              </View>)}
        <View style={[styles.card, { backgroundColor: theme.colors.lime }]}>
          <View style={styles.row}>
            <View style={styles.copy}>
              <Text style={[theme.type.meta, { color: colors.light.inkSecondary }]}>Invite code</Text>
              <Text style={[theme.type.cardHeading, { color: colors.light.ink }]}>{inviteCode}</Text>
            </View>
            <AppButton label="Share invite" testID="groupDetail.invite.share" onPress={() => void shareInvite()} />
          </View>
          <Toggle label={qrOpen ? 'Hide QR' : 'Show QR'} testID="groupDetail.qr.toggle" expanded={qrOpen} onPress={() => setQrOpen(!qrOpen)} />
          {qrOpen ? <CodeQr group value={`bitedown://group/${data.group.invite_code}`}
            label={`Invite code ${inviteCode}, QR`} testID="groupDetail.invite.qr" /> : null}
        </View>
        {confirm ? <View style={styles.card} testID="groupDetail.leave.confirmation">
          <Text accessibilityRole="header" style={styles.heading}>Leave {data.group.name}?</Text>
          <AppButton label="Leave group" testID="groupDetail.leave.confirm" disabled={leaving} loading={leaving} onPress={() => void leave()} />
          <AppButton label="Cancel" testID="groupDetail.leave.cancel" disabled={leaving} variant="outline" onPress={() => { setConfirm(false); setActionError(null); }} />
        </View> : <AppButton label="Leave group" testID="groupDetail.leave.button" variant="outline" onPress={() => setConfirm(true)} />}
        {actionError ? <View style={styles.section}>
          <Text accessibilityRole="alert" style={styles.error}>{actionError.message}</Text>
          <AppButton label="Try again" testID="groupDetail.action.retry" disabled={leaving}
            onPress={() => { if (actionError.action === 'leave') void leave(); else void shareInvite(); }} />
        </View> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
