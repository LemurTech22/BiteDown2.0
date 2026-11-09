import { StyleSheet, Text, TextInput, View } from 'react-native';

import { type CreateItemInput, type ItemCandidate } from '@/api';
import { AppButton } from '@/components/ui/app-button';
import { type AppTheme, useTheme } from '@/theme';

import { ChoiceControl } from './choice-control';

export interface CandidateDraft {
  id: number;
  candidate: ItemCandidate;
  name: string;
  quantity: string;
  storage: ItemCandidate['storage'];
  expiry: string;
}

export function draftError(draft: CandidateDraft): string | undefined {
  if (!draft.name.trim()) return 'Enter a food name.';
  if (!draft.quantity.trim() || !Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0) {
    return 'Enter a quantity greater than zero.';
  }
  const parsed = new Date(`${draft.expiry}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry) || !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== draft.expiry) return 'Enter a valid expiry date (YYYY-MM-DD).';
}

export function toCreateItem(draft: CandidateDraft, mode: 'fridge' | 'single'): CreateItemInput {
  const { candidate } = draft;
  return {
    name: draft.name.trim(), quantity: Number(draft.quantity), unit: candidate.unit,
    storage: draft.storage, predicted_expiry: draft.expiry,
    expiry_source: draft.expiry === candidate.predicted_expiry ? candidate.expiry_source : 'user',
    category: candidate.category, food_group: candidate.food_group,
    source: candidate.source ?? (mode === 'single' ? 'single_photo' : 'photo'),
    est_price: candidate.est_price,
    est_weight_kg: Number(draft.quantity) === candidate.quantity ? candidate.est_weight_kg : undefined,
    freshness: candidate.freshness, confidence: candidate.confidence, nutrition: candidate.nutrition,
  };
}

export function CandidateEditor({ draft, disabled, onChange, onDrop }: {
  draft: CandidateDraft;
  disabled: boolean;
  onChange: (patch: Partial<CandidateDraft>) => void;
  onDrop: () => void;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const error = draftError(draft);
  const id = draft.id;
  const status = draft.candidate.freshness === 'spoiled' ? 'Looks off' :
    draft.candidate.freshness === 'semi_fresh' ? 'Use soon' :
      draft.candidate.confidence != null && draft.candidate.confidence < 0.5 ? 'Not sure' : null;
  return (
    <View style={styles.card} testID={`add.candidate.${id}`}>
      <Text style={styles.meta}>Predicted expiry: {draft.candidate.predicted_expiry}</Text>
      {status ? <Text style={[styles.status, status === 'Use soon' && styles.useSoon]}>{status}</Text> : null}
      {(['name', 'quantity', 'expiry'] as const).map((field) => {
        const label = field === 'name' ? 'Food name' : field === 'quantity' ? `Quantity (${draft.candidate.unit})` : 'Expiry date (YYYY-MM-DD)';
        return (
          <View key={field} style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput accessibilityLabel={`${label}, item ${id + 1}`} editable={!disabled}
              autoCorrect={false} autoCapitalize={field === 'name' ? 'sentences' : 'none'}
              keyboardType={field === 'quantity' ? 'decimal-pad' : 'default'}
              maxLength={field === 'name' ? 200 : field === 'expiry' ? 10 : 12}
              value={draft[field]} onChangeText={(value) => onChange({ [field]: value })}
              selectionColor={theme.colors.forest} style={styles.input} testID={`add.${field}.${id}`} />
          </View>
        );
      })}
      <ChoiceControl label={`Storage, item ${id + 1}`} options={[
        { value: 'fridge', label: 'Fridge' }, { value: 'pantry', label: 'Pantry' }, { value: 'freezer', label: 'Freezer' },
      ]} value={draft.storage} onChange={(storage) => onChange({ storage })}
        testID={`add.storage${id}`} disabled={disabled} />
      {error ? <Text accessibilityRole="alert" style={styles.error} testID={`add.validation.${id}`}>{error}</Text> : null}
      <AppButton label="Drop item" accessibilityLabel={`Drop ${draft.name || `item ${id + 1}`}`}
        onPress={onDrop} disabled={disabled} testID={`add.drop.${id}`} variant="outline" />
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card, gap: theme.spacing.md, padding: theme.spacing.lg },
    field: { gap: theme.spacing.sm },
    meta: { ...theme.type.meta, color: theme.colors.muted },
    status: { ...theme.type.badge, color: theme.colors.urgentInk, backgroundColor: theme.colors.urgentBg,
      padding: theme.spacing.sm, borderRadius: theme.radii.chip, alignSelf: 'flex-start' },
    useSoon: { color: theme.colors.useSoonInk, backgroundColor: theme.colors.useSoonBg },
    label: { ...theme.type.formLabel, color: theme.colors.inkSecondary },
    input: { ...theme.type.bodyLarge, color: theme.colors.ink, minHeight: theme.sizes.input,
      borderColor: theme.colors.border, borderWidth: theme.sizes.borderHairline, borderRadius: theme.radii.input,
      paddingHorizontal: theme.spacing.tileInner, paddingVertical: theme.spacing.sm },
    error: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
  });
}
