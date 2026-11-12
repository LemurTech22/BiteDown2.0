import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api';
import { reportServerError } from '@/components/server-error';
import { AppIcon } from '@/components/ui/app-icon';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { StateView } from '@/components/ui/state-view';
import { useTheme } from '@/theme';

import { backToSocial, SocialError, SocialPage, socialStyles, TextAction } from './social-ui';
import { errorMessage, useSocialData } from './use-social-data';

export function RequestComposerScreen() {
  const { api } = useApi();
  const theme = useTheme();
  const styles = socialStyles(theme);
  const state = useSocialData(useCallback(async () => {
    const [groups, friends] = await Promise.all([api.getGroups(), api.getFriends()]);
    return { groups: groups.groups, friends: friends.friends.length };
  }, [api]));
  const [text, setText] = useState('');
  const [friends, setFriends] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const valid = text.trim().length > 0 && (friends || groupIds.length > 0) && state.status === 'ready';
  async function post() {
    if (!valid || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await api.createRequest({ text: text.trim(), audiences: { friends, group_ids: groupIds } });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      backToSocial();
    } catch (cause) {
      reportServerError(cause);
      setError(errorMessage(cause));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <SocialPage title="Ask for something" screen="requestComposer"
      leading={<TextAction label="Cancel" testID="requestComposer.cancel.button" disabled={pending} onPress={backToSocial} />}
      action={<TextAction label={pending ? 'Posting…' : 'Post'} filled testID="requestComposer.post.button"
        disabled={!valid || pending} onPress={() => void post()} />}>
      <View style={styles.note}>
        <Text style={styles.meta}>Your note</Text>
        <TextInput accessibilityLabel="Your note" accessibilityHint="Up to 280 characters" multiline maxLength={280}
          editable={!pending} value={text} onChangeText={(value) => setText(value.slice(0, 280))}
          placeholder="Anyone have 2 eggs? Baking tonight." placeholderTextColor={theme.colors.muted}
          selectionColor={theme.colors.forest} textAlignVertical="top" testID="requestComposer.note.input"
          style={[styles.heading, { minHeight: theme.sizes.removalOption, paddingVertical: theme.spacing.sm }]} />
        <Text accessibilityLabel={`${text.length} of 280 characters`} style={[styles.meta, { alignSelf: 'flex-end' }]}
          testID="requestComposer.note.counter">{text.length} / 280</Text>
      </View>
      <Text accessibilityRole="header" style={styles.name}>Who can see it</Text>
      {state.status === 'loading' || pending ? <SkeletonRows testID="requestComposer.loading.skeleton" /> : null}
      {state.status === 'error' ? <SocialError screen="requestComposer" message={state.error} onRetry={() => void state.reload()} /> : null}
      {state.status === 'ready' && state.data ? <View style={styles.section}>
        <AudienceRow id="friends" name="Friends" meta={`${state.data.friends} ${state.data.friends === 1 ? 'friend' : 'friends'}`}
          selected={friends} disabled={pending} onPress={() => setFriends((value) => !value)} />
        {state.data.groups.map((group) => <AudienceRow key={group.id} id={group.id} name={group.name}
          meta={`Group · ${group.member_count} members`} selected={groupIds.includes(group.id)}
          disabled={pending || (!groupIds.includes(group.id) && groupIds.length >= 50)}
          onPress={() => setGroupIds((ids) => ids.includes(group.id) ? ids.filter((id) => id !== group.id) : [...ids, group.id])} />)}
        {!state.data.groups.length ? <StateView icon="account-group-outline" title="No groups yet" message="You can share your note with Friends."
          testID="requestComposer.groups.empty" /> : null}
        <Text style={styles.meta}>Pick at least one</Text>
      </View> : null}
      {error ? <SocialError screen="requestComposer.post" message={error} onRetry={() => void post()} /> : null}
    </SocialPage>
  </KeyboardAvoidingView>;
}

function AudienceRow({ id, name, meta, selected, disabled, onPress }: {
  id: string; name: string; meta: string; selected: boolean; disabled: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  const styles = socialStyles(theme);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={name} accessibilityState={{ checked: selected, disabled }}
    testID={`requestComposer.audience.${id}`} disabled={disabled} onPress={onPress}
    style={[styles.card, styles.row, { minHeight: theme.sizes.primaryButton, borderWidth: theme.sizes.borderHairline,
      borderColor: selected ? theme.colors.forest : theme.colors.border }]}>
    <AppIcon name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
      color={selected ? theme.colors.forest : theme.colors.muted} size={theme.sizes.iconLarge} />
    <View style={{ flex: 1 }}><Text style={styles.name}>{name}</Text><Text style={styles.meta}>{meta}</Text></View>
  </Pressable>;
}
