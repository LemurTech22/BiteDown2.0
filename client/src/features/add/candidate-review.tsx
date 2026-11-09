import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ItemCandidate, ItemSource } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/app-icon';
import { FadeIn } from '@/components/ui/fade-in';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatMoney, formatWeight, usePreferences } from '@/settings/preferences';
import { type AppTheme, useTheme } from '@/theme';

import { CandidateEditor, type CandidateDraft } from './candidate-editor';

export interface ReviewDraft extends CandidateDraft { selected: boolean; nonFood: boolean }

// No is_food field exists in the contract. Keep unknown foods selected; only
// recognisable household goods start unticked, regardless of food_group=other.
export function isNonFood(candidate: ItemCandidate): boolean {
  return /\b(paper towels?|ppr twl|toilet (paper|tissue)|bath tissue|detergent|dish soap|shampoo|conditioner|bleach|trash bags?|garbage bags?|alumin(?:um|ium) foil|plastic wrap|toothpaste|deodorant|napkins?|diapers?|batteries)\b/i
    .test(`${candidate.name} ${candidate.receipt_text ?? ''}`);
}

export function reviewDrafts(candidates: ItemCandidate[], source: ItemSource): ReviewDraft[] {
  return candidates.map((candidate, id) => {
    const nonFood = source === 'receipt' && isNonFood(candidate);
    return { id, candidate: { ...candidate, source }, name: candidate.name, quantity: String(candidate.quantity),
      storage: candidate.storage, expiry: candidate.predicted_expiry, selected: !nonFood, nonFood };
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
  if (!estimated) return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
  if (days <= 7) return `${days - 1}–${days} days`;
  if (days <= 14) return '1–2 weeks';
  if (days <= 21) return '2–3 weeks';
  return '3+ weeks';
}

export function CandidateReview({ drafts, screen, receipt = false, disabled, onChange }: {
  drafts: ReviewDraft[]; screen: string; receipt?: boolean; disabled: boolean;
  onChange: (id: number, patch: Partial<ReviewDraft>) => void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const { currency, units } = usePreferences();
  const [editing, setEditing] = useState<number | null>(null);
  return <View style={styles.list}>
    {drafts.map((draft, index) => {
      const { candidate } = draft;
      const group = candidate.food_group.charAt(0).toUpperCase() + candidate.food_group.slice(1);
      const amount = candidate.unit === 'kg' ? formatWeight(Number(draft.quantity), units) :
        candidate.unit === 'g' ? formatWeight(Number(draft.quantity) / 1000, units) : `${draft.quantity} ${candidate.unit}`;
      const price = candidate.est_price ?? candidate.price;
      const estimated = draft.expiry === candidate.predicted_expiry;
      const expiry = expiryLabel(draft.expiry, estimated);
      const urgent = expiry === 'Today' || expiry === 'Tomorrow' || expiry === 'Expired';
      return <FadeIn key={draft.id} delay={reducedMotion ? 0 : Math.min(index, theme.motion.maxStaggerItems - 1) * theme.motion.staggerMs}>
        <View style={styles.row} testID={`${screen}.candidate.${draft.id}`}>
          <View style={styles.line}>
            <Pressable accessibilityRole="checkbox"
              accessibilityLabel={`${draft.name}, ${draft.nonFood ? 'Not food' : `${amount}, ${group}, use by ${draft.expiry}`}${receipt && candidate.receipt_text ? `, receipt line: ${candidate.receipt_text}` : ''}`}
              accessibilityState={{ checked: draft.selected, disabled }} disabled={disabled}
              testID={`${screen}.select.${draft.id}`} style={styles.selection}
              onPress={() => onChange(draft.id, { selected: !draft.selected })}>
              <AppIcon name={draft.selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} color={theme.colors.forest} />
              <View style={styles.copy}>
                <Text style={styles.name}>{draft.name}</Text>
                {receipt && candidate.receipt_text ? <Text style={styles.raw}>{candidate.receipt_text}</Text> : null}
                <View style={styles.metaLine}>
                  <Text style={styles.meta}>{draft.nonFood ? 'Not food' : receipt ? group : `${amount} · ${group}`}</Text>
                  {!draft.nonFood ? <Text accessibilityLabel={`Use by ${draft.expiry}, ${estimated ? 'estimated' : 'your date'}`}
                    testID={`${screen}.expiryBadge.${draft.id}`} style={[styles.badge, urgent && styles.urgent]}>{expiry}</Text> : null}
                </View>
              </View>
            </Pressable>
            {receipt && price != null ? <Text style={styles.price}>{formatMoney(price, currency)}</Text> : null}
          </View>
          <AppButton label={editing === draft.id ? 'Done' : 'Edit'} accessibilityLabel={`${editing === draft.id ? 'Done editing' : 'Edit'} ${draft.name}`}
            variant="outline" testID={`${screen}.edit.${draft.id}`} disabled={disabled}
            onPress={() => setEditing(editing === draft.id ? null : draft.id)} />
          {editing === draft.id ? <CandidateEditor draft={draft} disabled={disabled}
            onChange={(patch) => onChange(draft.id, patch)} onDrop={() => { onChange(draft.id, { selected: false }); setEditing(null); }} /> : null}
        </View>
      </FadeIn>;
    })}
  </View>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    list: { gap: theme.spacing.xs },
    row: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.row, padding: theme.spacing.md, gap: theme.spacing.sm },
    line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.sm },
    selection: { flex: 1, minWidth: '65%', minHeight: theme.sizes.touchTarget, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    copy: { flex: 1, gap: theme.spacing.xs },
    name: { ...theme.type.rowTitle, color: theme.colors.ink },
    raw: { ...theme.type.meta, color: theme.colors.muted },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    metaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.sm },
    badge: { ...theme.type.badge, color: theme.colors.forest, backgroundColor: theme.colors.limeTint,
      paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.radii.chip },
    urgent: { color: theme.colors.urgentInk, backgroundColor: theme.colors.urgentBg },
    price: { ...theme.type.formLabel, color: theme.colors.ink, fontVariant: ['tabular-nums'] },
  });
}
