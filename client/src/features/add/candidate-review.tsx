import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ItemCandidate, ItemSource } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { ItemThumb } from '@/components/ui/item-thumb';
import { STORAGE_OPTIONS } from '@/features/fridge/fridge-utils';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatMoney, usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

import { CandidateEditor, type CandidateDraft } from './candidate-editor';

export interface ReviewDraft extends CandidateDraft { selected: boolean; nonFood: boolean }

export function isNonFood(candidate: ItemCandidate): boolean {
  return /\b(paper towels?|ppr twl|toilet (paper|tissue)|bath tissue|detergent|dish soap|shampoo|conditioner|bleach|trash bags?|garbage bags?|alumin(?:um|ium) foil|plastic wrap|toothpaste|deodorant|napkins?|diapers?|batteries)\b/i
    .test(`${candidate.name} ${candidate.receipt_text ?? ''}`);
}

export function reviewDrafts(candidates: ItemCandidate[], source: ItemSource): ReviewDraft[] {
  return candidates.map((candidate, id) => {
    const nonFood = isNonFood(candidate);
    return { id, candidate: { ...candidate, source }, name: candidate.name, quantity: String(candidate.quantity),
      storage: candidate.storage, expiry: candidate.predicted_expiry, selected: source !== 'receipt' || !nonFood, nonFood };
  });
}

export function expiryLabel(expiry: string, estimated = true): string {
  const today = new Date();
  const date = new Date(`${expiry}T00:00:00`);
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (!Number.isFinite(days)) return 'Check expiry';
  if (days < 0) return 'Expired';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (!estimated) return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  if (days <= 7) return `${days - 1}–${days} days`;
  if (days <= 14) return '1–2 weeks';
  if (days <= 21) return '2–3 weeks';
  return '3+ weeks';
}

export function needsCheck(draft: ReviewDraft): boolean {
  return draft.nonFood || (draft.candidate.confidence != null && draft.candidate.confidence < 0.5);
}

export function CandidateReview({ drafts, screen, receipt = false, disabled, onChange }: {
  drafts: ReviewDraft[]; screen: string; receipt?: boolean; disabled: boolean;
  onChange: (id: number, patch: Partial<ReviewDraft>) => void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const { currency } = usePreferences();
  const [editing, setEditing] = useState<number | null>(null);
  const editor = drafts.find((draft) => draft.id === editing);
  const sections = [
    { title: null, items: drafts.filter((draft) => draft.candidate.freshness !== 'spoiled') },
    { title: 'Looks spoiled', items: drafts.filter((draft) => draft.candidate.freshness === 'spoiled') },
  ];
  return <View style={styles.list}>
    {sections.map(({ title, items }) => <View key={title ?? 'food'} style={styles.list}>
      {title && items.length ? <Text accessibilityRole="header" style={styles.name}>{title}</Text> : null}
      {[...items].sort((a, b) => Number(needsCheck(b)) - Number(needsCheck(a))).map((draft, index) => {
        const { candidate } = draft;
        const estimated = draft.expiry === candidate.predicted_expiry;
        const expiry = expiryLabel(draft.expiry, estimated);
        const storage = STORAGE_OPTIONS.find((option) => option.value === draft.storage)!.label;
        const price = candidate.est_price ?? candidate.price;
        const meta = draft.nonFood ? 'Not food' : `${storage} · ${estimated && !['Today', 'Tomorrow', 'Expired', 'Check expiry'].includes(expiry) ? 'use in ' : ''}${expiry}`;
        return <FadeIn key={draft.id} delay={reducedMotion ? 0 : Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.staggerMs}>
          <View style={styles.row} testID={`${screen}.candidate.${draft.id}`}>
            <View style={styles.line}>
              <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${draft.name}`}
                accessibilityState={{ checked: draft.selected, disabled }} disabled={disabled}
                testID={`${screen}.select.${draft.id}`} style={styles.selection}
                onPress={() => onChange(draft.id, { selected: !draft.selected,
                  ...(candidate.freshness === 'spoiled' && draft.spoilDecision === 'toss' ? { spoilDecision: undefined } : {}) })}>
                <AppIcon name={draft.selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} color={theme.colors.forest} />
              </Pressable>
              <ItemThumb name={draft.name} foodGroup={draft.foodGroup ?? candidate.food_group} photoUrl={candidate.photo_preview_url} />
              <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${draft.name}, ${meta}${needsCheck(draft) ? ', Check this' : ''}${receipt && candidate.receipt_text ? `, receipt line: ${candidate.receipt_text}` : ''}`}
                accessibilityHint="Double-tap to change" disabled={disabled} style={styles.copy}
                testID={`${screen}.edit.${draft.id}`} onPress={() => setEditing(draft.id)}>
                <Text style={styles.name}>{draft.name}</Text>
                <Text style={styles.meta} testID={!draft.nonFood ? `${screen}.expiryBadge.${draft.id}` : undefined}>{meta}</Text>
                {needsCheck(draft) ? <View style={styles.tag} testID={`${screen}.check.${draft.id}`}>
                  <AppIcon name="alert-circle-outline" size={theme.sizes.iconSmall} color={theme.colors.urgentInk} />
                  <Text style={styles.check}>Check this</Text>
                </View> : null}
              </Pressable>
              {receipt && price != null ? <Text style={styles.price}>{formatMoney(price, currency)}</Text> : null}
            </View>
            {candidate.freshness === 'spoiled' ? <View style={styles.decisions}>
              <AppButton label={draft.spoilDecision === 'toss' ? 'Toss ✓' : 'Toss'} accessibilityLabel={`Toss ${draft.name}`}
                variant="outline" disabled={disabled} testID={`${screen}.toss.${draft.id}`}
                onPress={() => onChange(draft.id, { spoilDecision: 'toss', selected: false })} />
              <AppButton label={draft.spoilDecision === 'keep' ? 'Keep ✓' : 'Keep'} accessibilityLabel={`Keep ${draft.name}`}
                variant="outline" disabled={disabled} testID={`${screen}.keep.${draft.id}`}
                onPress={() => onChange(draft.id, { spoilDecision: 'keep', selected: true })} />
            </View> : null}
          </View>
        </FadeIn>;
      })}
    </View>)}
    {editor ? <CandidateEditor key={editor.id} draft={editor} screen={screen}
      onChange={(patch) => onChange(editor.id, patch)} onClose={() => setEditing(null)} /> : null}
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    list: { gap: theme.spacing.xs },
    row: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.row, padding: theme.spacing.md, gap: theme.spacing.sm },
    line: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    selection: { minWidth: theme.sizes.touchTarget, minHeight: theme.sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minHeight: theme.sizes.touchTarget, justifyContent: 'center', gap: theme.spacing.xs },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    tag: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    check: { ...theme.type.badge, color: theme.colors.urgentInk },
    decisions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    price: { ...theme.type.formLabel, color: theme.colors.ink, fontVariant: ['tabular-nums'], flexShrink: 1 },
  });
}
