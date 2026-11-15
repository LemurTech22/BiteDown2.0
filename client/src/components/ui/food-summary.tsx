import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodGroup, Freshness, Storage, UpdateItemInput } from '@/api';
import { FOOD_GROUPS, STORAGE_OPTIONS } from '@/features/fridge/fridge-utils';
import { ItemField } from '@/features/item/item-field';
import { type AppTheme, useTheme } from '@/theme';

import { AppButton } from './app-button';
import { AppIcon } from './app-icon';
import { DateChoices, dateSummary, relativeDate } from './date-sheet';
import { EditSheet } from './edit-sheet';
import { FadeIn } from './fade-in';

export interface FoodValues {
  name: string; quantity: number; unit: string; storage: Storage; food_group: FoodGroup;
  predicted_expiry: string | null; freshness?: Freshness | null;
}
export type FoodField = 'storage' | 'expiry' | 'freshness' | 'group' | 'amount';
const TITLES = { storage: 'Stored in', expiry: 'Use by', freshness: 'Freshness', group: 'Food group', amount: 'Name & amount', summary: 'Item details' };
const FRESHNESS = [
  { value: 'fresh', label: 'Fresh' }, { value: 'semi_fresh', label: 'Use soon' },
  { value: 'spoiled', label: 'Looks off' }, { value: 'unknown', label: 'Not checked' },
] as const;

export function FoodSummary({ values, estimated, onEdit, disabled, testID }: {
  values: FoodValues; estimated: boolean; onEdit: (field: FoodField) => void; disabled?: boolean; testID: string;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const date = values.predicted_expiry ?? '';
  const rows: { field: FoodField; value: string; hint?: string }[] = [
    { field: 'storage', value: STORAGE_OPTIONS.find((option) => option.value === values.storage)!.label },
    { field: 'expiry', value: `${dateSummary(date)}${estimated ? ' · estimated' : ''}`, hint: relativeDate(date) },
    { field: 'freshness', value: FRESHNESS.find((option) => option.value === (values.freshness ?? 'unknown'))!.label },
    { field: 'group', value: FOOD_GROUPS.find((option) => option.value === values.food_group)!.label },
    { field: 'amount', value: `${values.name} · ${values.quantity} ${values.unit}` },
  ];
  return <View testID={`${testID}.summary`}>
    {rows.map(({ field, value, hint }) => <Pressable key={field} accessibilityRole="button"
      accessibilityLabel={`${TITLES[field]}, ${value}${hint ? `, ${hint}` : ''}`} accessibilityHint="Double-tap to change"
      accessibilityState={{ disabled }} disabled={disabled} style={styles.row} testID={`${testID}.${field}.row`} onPress={() => onEdit(field)}>
      <Text style={styles.label}>{TITLES[field]}</Text>
      <FadeIn key={`${value}-${hint}`} style={styles.value}><Text style={[styles.valueText, styles.right]}>{value}</Text>{hint ? <Text style={[styles.meta, styles.right]}>{hint}</Text> : null}</FadeIn>
      <AppIcon name="chevron-right" color={theme.colors.muted} />
    </Pressable>)}
  </View>;
}

export function FoodEditSheet({ field: initialField, values, estimated, storageExpirySource, onSave, onClose, testID }: {
  field: FoodField | 'summary'; values: FoodValues; estimated: boolean; storageExpirySource?: string;
  onSave: (patch: UpdateItemInput) => Promise<void>; onClose: () => void; testID: string;
}) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [field, setField] = useState(initialField);
  const [name, setName] = useState(values.name);
  const [quantity, setQuantity] = useState(String(values.quantity));
  const [unit, setUnit] = useState(values.unit);
  const [reestimate, setReestimate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const closed = useRef(false);
  const attempt = useRef<UpdateItemInput | null>(null);
  const invalid = !name.trim() ? 'Enter a food name.' : !quantity.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0
    ? 'Enter a quantity greater than zero.' : !unit.trim() ? 'Enter a unit.' : '';
  function close() {
    if (busy.current || closed.current) return;
    closed.current = true;
    onClose();
  }
  async function save(patch: UpdateItemInput) {
    if (busy.current || closed.current) return;
    busy.current = true; attempt.current = patch; setPending(true); setError('');
    try {
      await onSave(patch);
      busy.current = false;
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t save changes. Try again.');
    } finally { busy.current = false; setPending(false); }
  }
  const choices = field === 'storage' ? STORAGE_OPTIONS : field === 'group' ? FOOD_GROUPS : field === 'freshness' ? FRESHNESS : [];
  const current = field === 'storage' ? values.storage : field === 'group' ? values.food_group : values.freshness ?? 'unknown';
  return <EditSheet title={TITLES[field]} testID={`${testID}.sheet`} pending={pending} onClose={close}>
    {field === 'summary' ? <FoodSummary values={values} estimated={estimated} onEdit={setField} testID={testID} /> : null}
    {field === 'storage' && storageExpirySource ? storageExpirySource === 'user' ?
      <Pressable accessibilityRole="switch" accessibilityLabel="Re-estimate expiry for the new spot"
        accessibilityState={{ checked: reestimate, disabled: pending }} disabled={pending} style={styles.row}
        testID={`${testID}.reestimate`} onPress={() => setReestimate((value) => !value)}>
        <Text style={styles.valueText}>Re-estimate expiry for the new spot</Text>
        <AppIcon name={reestimate ? 'checkbox-marked' : 'checkbox-blank-outline'} color={theme.colors.forest} />
      </Pressable> : <Text style={styles.meta}>Expiry updates for the new spot.</Text> : null}
    {choices.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
      accessibilityState={{ checked: option.value === current, disabled: pending }} disabled={pending} style={styles.row}
      testID={`${testID}.${field}.${option.value}`} onPress={() => {
        const patch: UpdateItemInput = field === 'storage' ? { storage: option.value as Storage,
          ...(reestimate && option.value !== values.storage ? { reestimate_expiry: true } : {}) }
          : field === 'group' ? { food_group: option.value as FoodGroup }
          : { freshness: option.value === 'unknown' ? null : option.value as Freshness };
        void save(patch);
      }}>
      <Text style={styles.valueText}>{option.label}</Text>
      <AppIcon name={option.value === current ? 'radiobox-marked' : 'radiobox-blank'} color={theme.colors.forest} />
    </Pressable>)}
    {field === 'expiry' ? <DateChoices value={values.predicted_expiry ?? ''} disabled={pending} testID={`${testID}.date`}
      onSelect={(predicted_expiry) => void save({ predicted_expiry })} /> : null}
    {field === 'amount' ? <>
      <ItemField label="Food name" testID={`${testID}.name.input`} value={name} maxLength={200} editable={!pending} onChangeText={setName} />
      <ItemField label="Quantity" testID={`${testID}.quantity.input`} value={quantity} maxLength={12} keyboardType="decimal-pad" editable={!pending} onChangeText={setQuantity} />
      <ItemField label="Unit" testID={`${testID}.unit.input`} value={unit} maxLength={32} editable={!pending} onChangeText={setUnit} />
      {invalid ? <Text accessibilityRole="alert" style={styles.error}>{invalid}</Text> : null}
      <AppButton label="Save" testID={`${testID}.save`} disabled={pending || Boolean(invalid)} loading={pending}
        onPress={() => void save({ name: name.trim(), quantity: Number(quantity), unit: unit.trim() })} />
    </> : null}
    {error ? <View style={styles.section} testID={`${testID}.error`}>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <AppButton label="Try again" testID={`${testID}.retry`} disabled={pending}
        onPress={() => { if (attempt.current) void save(attempt.current); }} />
    </View> : null}
  </EditSheet>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    row: { minHeight: theme.sizes.touchTarget, paddingVertical: theme.spacing.md, gap: theme.spacing.sm,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: theme.sizes.borderHairline, borderBottomColor: theme.colors.hairline },
    label: { ...theme.type.bodySmall, color: theme.colors.inkSecondary, flex: 1 },
    value: { flex: 1, gap: theme.spacing.xs }, valueText: { ...theme.type.body, color: theme.colors.ink, flexShrink: 1 },
    right: { textAlign: 'right' },
    meta: { ...theme.type.meta, color: theme.colors.muted }, section: { gap: theme.spacing.sm },
    error: { ...theme.type.bodySmall, color: theme.colors.urgentInk },
  });
}
