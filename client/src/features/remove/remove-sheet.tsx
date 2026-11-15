import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError, useApi, type Item, type ReachablePerson, type RemoveItemInput, type WasteReason } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { bottomSheetPanelStyle } from '@/components/ui/bottom-sheet-panel-style';
import { FadeIn } from '@/components/ui/fade-in';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { ExpiryBadge } from '@/features/fridge/expiry-badge';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { ItemThumb } from '@/components/ui/item-thumb';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';
import type { Units } from '@/settings/preferences';

const REASONS: { value: WasteReason; label: string; icon: IconName }[] = [
  { value: 'expired', label: 'Expired', icon: 'calendar-remove-outline' },
  { value: 'forgot', label: 'Forgot about it', icon: 'clock-outline' },
  { value: 'didnt_like', label: 'Didn’t like it', icon: 'thumb-down-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
];

interface RemoveSheetProps {
  item: Item;
  initialShared?: boolean;
  units?: Units;
  onClose: () => void;
  onRemoved: (item: Item) => void;
}

export function RemoveSheet({ item, initialShared = false, units = 'us', onClose, onRemoved }: RemoveSheetProps) {
  const { api } = useApi();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [reasonStep, setReasonStep] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(initialShared);
  const [menuOpen, setMenuOpen] = useState(false);
  const [people, setPeople] = useState<ReachablePerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleError, setPeopleError] = useState('');
  const [recipient, setRecipient] = useState<string | null>(item.share?.claimed_by?.id ?? null);
  const [recipientChosen, setRecipientChosen] = useState(false);
  const peopleSequence = useRef(0);
  const lastInput = useRef<RemoveItemInput | null>(null);
  const submitting = useRef(false);
  const styles = createStyles(theme);
  const loadPeople = useCallback(async () => {
    const version = ++peopleSequence.current;
    setPeopleLoading(true); setPeopleError('');
    try {
      const response = await api.getReachablePeople(item.id);
      if (version === peopleSequence.current) setPeople(response.people);
    } catch (cause) {
      if (version === peopleSequence.current) setPeopleError(cause instanceof Error ? cause.message : 'Couldn’t load people. Try again.');
    } finally { if (version === peopleSequence.current) setPeopleLoading(false); }
  }, [api, item.id]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active && shared) return loadPeople(); });
    return () => { active = false; peopleSequence.current += 1; };
  }, [shared, loadPeople]);
  const recipientName = recipient === null ? 'Someone not on BiteDown' :
    people.find((person) => person.id === recipient)?.display_name ?? item.share?.claimed_by?.name ?? 'Group member';

  async function remove(input: RemoveItemInput) {
    // The reason step never sends an incomplete removal, including on retry.
    if (submitting.current || (input.outcome === 'thrown_out' && !input.waste_reason)) return;
    submitting.current = true;
    lastInput.current = input;
    setError(null);
    setPending(true);
    let removed: Item;
    try {
      const response = await api.removeItem(item.id, input);
      removed = response.item;
    } catch (cause) {
      if (isApiError(cause) && cause.code === 'already_removed') {
        // Callers use removed_at to hide the item and offer Undo.
        removed = { ...item, removed_at: item.removed_at ?? new Date().toISOString(), outcome: input.outcome, waste_reason: input.waste_reason ?? null };
      } else {
        setError(cause instanceof Error ? cause.message : 'Couldn’t remove this item. Try again.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onRemoved(removed);
    onClose();
  }

  return (
    <Modal
      visible
      animationType={reducedMotion ? 'fade' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={() => { if (!submitting.current) onClose(); }}
      testID="remove.sheet.modal">
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View accessibilityViewIsModal testID="remove.sheet.panel" style={[styles.sheet, bottomSheetPanelStyle(theme)]}>
            {reasonStep ? (
              <AppButton
                label="Back"
                accessibilityLabel="Back to removal outcomes"
                testID="remove.back.button"
                variant="outline"
                disabled={pending}
                onPress={() => { setReasonStep(false); setError(null); }}
              />
            ) : null}
            <View style={styles.header}>
              <ItemThumb name={item.name} foodGroup={item.food_group} photoUrl={item.photo_url} />
              <View style={styles.copy}>
                <Text accessibilityRole="header" style={styles.title}>
                  {reasonStep ? 'Why was it thrown out?' : item.name}
                </Text>
                <Text style={styles.meta}>{reasonStep ? item.name : quantityLabel(item, units)}</Text>
              </View>
              {!reasonStep ? <ExpiryBadge item={item} testID={`remove.status.${item.id}`} /> : null}
            </View>
            {pending ? <SkeletonRows testID="remove.loading.skeleton" /> : (
              <FadeIn key={reasonStep ? 'reasons' : 'outcomes'} style={styles.options}>
                {reasonStep ? REASONS.map((reason) => (
                  <Pressable
                    key={reason.value}
                    accessibilityRole="button"
                    accessibilityLabel={reason.label}
                    testID={`remove.reason.${reason.value}`}
                    onPress={() => void remove({ outcome: 'thrown_out', waste_reason: reason.value })}
                    style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                    <AppIcon name={reason.icon} color={theme.colors.forest} />
                    <Text style={styles.optionLabel}>{reason.label}</Text>
                  </Pressable>
                )) : (
                  <>
                    <OutcomeTile label="Used it" icon="check" id="used" onPress={() => void remove({ outcome: 'used' })} />
                    <OutcomeTile label="Shared it" icon="gift-outline" id="donated" selected={shared} onPress={() => { setShared(true); setError(null); }} />
                    <OutcomeTile label="Threw it away" icon="trash-can-outline" id="thrown_out" onPress={() => { setError(null); setReasonStep(true); }} />
                  </>
                )}
              </FadeIn>
            )}
            {shared && !reasonStep && !pending ? <View style={styles.options} testID="remove.recipient.section">
              {menuOpen ? <View style={styles.options} testID="remove.recipient.menu">
                {peopleLoading ? <SkeletonRows testID="remove.people.loading" /> : people.map((person) => <AppButton
                  key={person.id} label={person.display_name} accessibilityLabel={`${person.display_name}${person.is_claimer ? ', Claimed it' : ''}`}
                  testID={`remove.recipient.${person.id}`} variant="outline" onPress={() => { setRecipient(person.id); setRecipientChosen(true); setMenuOpen(false); }} />)}
                <AppButton label="Someone not on BiteDown" testID="remove.recipient.other" variant="outline"
                  onPress={() => { setRecipient(null); setRecipientChosen(true); setMenuOpen(false); }} />
                {peopleError ? <><Text accessibilityRole="alert" style={styles.error}>{peopleError}</Text>
                  <AppButton label="Try again" testID="remove.people.retry" onPress={() => void loadPeople()} /></> : null}
              </View> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Given to ${recipientName}${recipient === item.share?.claimed_by?.id ? ', Claimed it' : ''}`}
                accessibilityState={{ expanded: menuOpen }} testID="remove.recipient.button" onPress={() => setMenuOpen((current) => !current)} style={styles.option}>
                <Text style={styles.optionLabel}>Given to</Text><Text style={[styles.meta, styles.recipient]}>{recipientName}</Text>
                {recipient === item.share?.claimed_by?.id ? <AppIcon name="account-check-outline" color={theme.colors.forest} /> : null}
              </Pressable>
              <AppButton label="Done" testID="remove.shared.done" onPress={() => void remove({ outcome: 'donated', ...(recipientChosen ? { recipient_id: recipient } : {}) })} />
            </View> : null}
            {error ? (
              <FadeIn style={styles.options} testID="remove.error.state">
                <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
                <AppButton
                  label="Try again"
                  testID="remove.error.retry"
                  disabled={pending}
                  onPress={() => { if (lastInput.current) void remove(lastInput.current); }}
                />
              </FadeIn>
            ) : null}
            <AppButton label="Cancel" testID="remove.cancel.button" variant="outline" disabled={pending} onPress={onClose} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OutcomeTile({ label, icon, id, onPress, selected = false }: { label: string; icon: IconName; id: string; onPress: () => void; selected?: boolean }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={`remove.outcome.${id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.option, (pressed || selected) && styles.pressed]}>
      <View style={styles.outcomeIcon}><AppIcon name={icon} color={theme.colors.forest} /></View>
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.ground },
    content: { flexGrow: 1, justifyContent: 'flex-end' },
    sheet: { gap: theme.spacing.sheetSection, padding: theme.spacing.gutter },
    header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.md },
    copy: { flexGrow: 1, flexShrink: 1, minWidth: '50%', gap: theme.spacing.xxs },
    title: { ...theme.type.sheetTitleCompact, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    recipient: { flex: 1, flexShrink: 1 },
    options: { gap: theme.spacing.tileGap },
    option: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.tileInner,
      minHeight: theme.sizes.removalOption, padding: theme.spacing.lg,
      borderRadius: theme.radii.row, borderColor: theme.colors.border,
      borderWidth: theme.sizes.borderHairline, backgroundColor: theme.colors.surface,
    },
    outcomeIcon: { width: theme.sizes.itemIcon, height: theme.sizes.itemIcon, borderRadius: theme.radii.input, backgroundColor: theme.colors.limeTint, alignItems: 'center', justifyContent: 'center' },
    optionLabel: { ...theme.type.button, color: theme.colors.ink, flexShrink: 1 },
    error: { ...theme.type.body, color: theme.colors.urgentInk },
    pressed: { backgroundColor: theme.colors.limeTint },
  });
}
