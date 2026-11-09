import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi, type Item, type RemoveItemInput, type WasteReason } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon, type IconName } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { SkeletonRows } from '@/components/ui/skeleton-rows';
import { FreshnessBadge } from '@/features/fridge/freshness-badge';
import { quantityLabel } from '@/features/fridge/fridge-utils';
import { groupIcon } from '@/features/fridge/item-row';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { type AppTheme, useTheme } from '@/theme';

const REASONS: { value: WasteReason; label: string; icon: IconName }[] = [
  { value: 'expired', label: 'Expired', icon: 'calendar-remove-outline' },
  { value: 'forgot', label: 'Forgot about it', icon: 'clock-outline' },
  { value: 'didnt_like', label: 'Didn’t like it', icon: 'thumb-down-outline' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
];

interface RemoveSheetProps {
  item: Item;
  onClose: () => void;
  onRemoved: (item: Item) => void;
}

export function RemoveSheet({ item, onClose, onRemoved }: RemoveSheetProps) {
  const { api } = useApi();
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [reasonStep, setReasonStep] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastInput = useRef<RemoveItemInput | null>(null);
  const submitting = useRef(false);
  const styles = createStyles(theme);

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
      setError(cause instanceof Error ? cause.message : 'Couldn’t remove this item. Try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
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
          <View accessibilityViewIsModal style={styles.sheet}>
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
              <View style={[styles.iconTile, { backgroundColor: theme.foodGroups[item.food_group].tile }]}>
                <AppIcon name={groupIcon(item.food_group)} color={theme.foodGroups[item.food_group].stroke} />
              </View>
              <View style={styles.copy}>
                <Text accessibilityRole="header" style={styles.title}>
                  {reasonStep ? 'Why was it thrown out?' : item.name}
                </Text>
                <Text style={styles.meta}>{reasonStep ? item.name : quantityLabel(item)}</Text>
              </View>
              {!reasonStep ? <FreshnessBadge freshness={item.freshness} itemId={item.id} /> : null}
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
                    <OutcomeTile label="Shared it" icon="gift-outline" id="donated" onPress={() => void remove({ outcome: 'donated' })} />
                    <OutcomeTile label="Threw it away" icon="trash-can-outline" id="thrown_out" onPress={() => { setError(null); setReasonStep(true); }} />
                  </>
                )}
              </FadeIn>
            )}
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

function OutcomeTile({ label, icon, id, onPress }: { label: string; icon: IconName; id: string; onPress: () => void }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`remove.outcome.${id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
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
    iconTile: { width: theme.sizes.itemIcon, height: theme.sizes.itemIcon, borderRadius: theme.radii.input, alignItems: 'center', justifyContent: 'center' },
    copy: { flexGrow: 1, flexShrink: 1, minWidth: '50%', gap: theme.spacing.xxs },
    title: { ...theme.type.sheetTitleCompact, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
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
