import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError, useApi, type FriendsResponse, type Group } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { Avatar, CodeField, connectStyles, Toggle } from '@/features/connect/connect-ui';
import { FriendCodeCard } from '@/features/connect/friend-code-card';
import { useTheme } from '@/theme';

export function ConnectScreen() {
  const params = useLocalSearchParams<{ invite?: string | string[] }>();
  const { api } = useApi();
  const theme = useTheme();
  const styles = connectStyles(theme);
  const [data, setData] = useState<{ friends: FriendsResponse; groups: Group[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailOpen, setEmailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const sequence = useRef(0);
  const invitePrefilled = useRef(false);

  useEffect(() => {
    const code = Array.isArray(params.invite) ? params.invite[0] : params.invite;
    if (invitePrefilled.current || !code) return;
    invitePrefilled.current = true;
    setInvite(code);
    setJoinOpen(true);
  }, [params.invite]);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [friends, { groups }] = await Promise.all([api.getFriends(), api.getGroups()]);
      if (request === sequence.current) setData({ friends, groups });
    } catch (cause) {
      reportServerError(cause);
      if (request === sequence.current) setLoadError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { sequence.current += 1; };
  }, [load]));

  async function mutate(key: string, action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    retry.current = () => mutate(key, action);
    setBusy(true);
    setError(null);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (cause) {
      reportServerError(cause);
      setError({ key, message: key === 'email' && isApiError(cause) && cause.status === 404
        ? 'No BiteDown account uses that email.' : cause instanceof Error ? cause.message : 'Please try again.' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function resolveRequest(id: string, accept: boolean) {
    await mutate('request', async () => {
      const accepted = accept ? (await api.acceptFriend(id)).friend : null;
      if (!accept) await api.deleteFriend(id);
      setData((current) => current ? { ...current, friends: { ...current.friends,
        incoming: current.friends.incoming.filter((friend) => friend.user_id !== id),
        outgoing: current.friends.outgoing.filter((friend) => friend.user_id !== id),
        friends: accepted ? [...current.friends.friends, accepted] : current.friends.friends,
      } } : current);
    });
  }

  return <SafeAreaView style={styles.screen}>
    <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Friends and groups</Text>
        <IconButton icon="close" label="Close" testID="connect.close.button" onPress={() => router.back()} />
      </View>
      {loading ? <SkeletonRows testID="connect.loading.skeleton" /> : loadError ? <StateView
        icon="cloud-off-outline" title="Couldn’t load friends and groups" message={loadError}
        testID="connect.error.state" actionLabel="Try again" actionTestID="connect.error.retry" onAction={() => void load()} /> : data ? <>
        {data.friends.incoming.length > 0 ? <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Friend requests</Text>
          {data.friends.incoming.map((friend) => <View style={styles.card} key={friend.user_id} testID={`connect.incoming.${friend.user_id}`}>
            <Text style={styles.name}>{friend.display_name}</Text><Text style={styles.meta}>wants to be friends</Text>
            <View style={styles.row}>
              <AppButton label="Decline" accessibilityLabel={`Decline ${friend.display_name}'s request`}
                testID={`connect.decline.${friend.user_id}`} variant="outline" disabled={busy} onPress={() => void resolveRequest(friend.user_id, false)} />
              <AppButton label="Accept" accessibilityLabel={`Accept ${friend.display_name}'s request`}
                testID={`connect.accept.${friend.user_id}`} disabled={busy} onPress={() => void resolveRequest(friend.user_id, true)} />
            </View>
          </View>)}
        </View> : null}
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Friends · {data.friends.friends.length}</Text>
          {data.friends.friends.length === 0 ? <StateView icon="account-multiple-outline" title="No friends yet"
            message="" testID="connect.friends.empty" /> : data.friends.friends.map((friend) => <View key={friend.user_id}
              style={[styles.card, styles.row]} testID={`connect.friend.${friend.user_id}`}>
              <Avatar name={friend.display_name} /><Text style={styles.name}>{friend.display_name}</Text>
            </View>)}
        </View>
        <FriendCodeCard />
        <View style={styles.section}>
          <Toggle label="Add by email" expanded={emailOpen} testID="connect.email.toggle" onPress={() => setEmailOpen(!emailOpen)} />
          {emailOpen ? <>
            <FormField label="Email" value={email} onChangeText={(value) => { setEmail(value); setError(null); }}
              testID="connect.email.input" errorTestID="connect.email.error" autoComplete="email" keyboardType="email-address"
              maxLength={254} editable={!busy} error={error?.key === 'email' ? error.message : undefined} />
            <AppButton label="Send request" testID="connect.email.send" disabled={busy || !email.trim()}
              onPress={() => void mutate('email', async () => {
                const { friend } = await api.addFriend({ email: email.trim() });
                setData((current) => current ? { ...current, friends: { ...current.friends, outgoing: [...current.friends.outgoing, friend] } } : current);
                setEmail('');
              })} />
          </> : null}
        </View>
        {data.friends.outgoing.length > 0 ? <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Sent · {data.friends.outgoing.length}</Text>
          {data.friends.outgoing.map((friend) => <View key={friend.user_id} style={styles.card}>
            <Text style={styles.name}>{friend.display_name}</Text>
            <AppButton label="Withdraw" accessibilityLabel={`Withdraw request to ${friend.display_name}`}
              testID={`connect.withdraw.${friend.user_id}`} variant="outline" disabled={busy} onPress={() => void resolveRequest(friend.user_id, false)} />
          </View>)}
        </View> : null}
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Groups · {data.groups.length}</Text>
          {data.groups.length === 0 ? <StateView icon="account-group-outline" title="No groups yet" message="" testID="connect.groups.empty" /> :
            data.groups.map((group) => <Pressable style={[styles.card, styles.row, { minHeight: theme.sizes.touchTarget }]} key={group.id}
              accessibilityRole="button" accessibilityLabel={`${group.name}, ${group.member_count} members`}
              testID={`connect.group.${group.id}`} onPress={() => router.push({ pathname: '/social/group/[id]', params: { id: group.id } })}>
              <AppIcon name="account-group-outline" color={theme.colors.forest} />
              <View style={styles.copy}>
                <Text style={styles.name}>{group.name}</Text>
                <Text style={styles.meta}>{group.member_count} {group.member_count === 1 ? 'member' : 'members'}</Text>
              </View>
              <AppIcon name="chevron-right" color={theme.colors.muted} />
            </Pressable>)}
          <Toggle label="Create a group" expanded={createOpen} testID="connect.create.toggle" onPress={() => setCreateOpen(!createOpen)} />
          {createOpen ? <>
            <FormField label="Group name" value={name} onChangeText={(value) => { setName(value); setError(null); }}
              autoComplete="name" maxLength={60} editable={!busy} testID="connect.create.input" errorTestID="connect.create.error"
              error={error?.key === 'create' ? error.message : undefined} />
            <AppButton label="Create" testID="connect.create.submit" disabled={busy || !name.trim()} onPress={() => void mutate('create', async () => {
              const { group } = await api.createGroup({ name: name.trim() });
              setData((current) => current ? { ...current, groups: [...current.groups, group] } : current);
              setName(''); setCreateOpen(false);
            })} />
          </> : null}
          <Toggle label="Join a group" expanded={joinOpen} testID="connect.join.toggle" onPress={() => setJoinOpen(!joinOpen)} />
          {joinOpen ? <>
            <CodeField label="Invite code" value={invite} onChangeText={(value) => { setInvite(value); setError(null); }}
              testID="connect.join.input" editable={!busy} error={error?.key === 'join' ? error.message : null} />
            <AppButton label="Join" testID="connect.join.submit" disabled={busy || !invite.trim()} onPress={() => void mutate('join', async () => {
              const { group } = await api.joinGroup({ invite_code: invite.trim() });
              setData((current) => current ? { ...current, groups: [...current.groups, group] } : current);
              setInvite(''); setJoinOpen(false);
              router.push({ pathname: '/social/group/[id]', params: { id: group.id } });
            })} />
          </> : null}
        </View>
        {error ? <View style={styles.section}>
          {error.key === 'request' ? <Text accessibilityRole="alert" style={styles.error}>{error.message}</Text> : null}
          <AppButton label="Try again" testID="connect.action.retry" disabled={busy} onPress={() => { void retry.current?.(); }} />
        </View> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
