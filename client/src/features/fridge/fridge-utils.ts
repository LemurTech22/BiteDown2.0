import type { FoodGroup, Item, Storage } from '@/api/types';
import { formatWeight, type Units } from '@/settings/preferences';

export const STORAGE_OPTIONS: { value: Storage; label: string }[] = [
  { value: 'fridge', label: 'Fridge' },
  { value: 'pantry', label: 'Pantry' },
  { value: 'freezer', label: 'Freezer' },
];

export const FOOD_GROUPS: { value: FoodGroup; label: string }[] = [
  { value: 'protein', label: 'Protein' },
  { value: 'veggies', label: 'Veggies' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'grains', label: 'Grains' },
  { value: 'pantry', label: 'Staples' },
  { value: 'leftovers', label: 'Leftovers' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'other', label: 'Other' },
];

export interface FoodGroupSection {
  foodGroup: FoodGroup;
  label: string;
  items: Item[];
}

export function groupItems(items: Item[]): FoodGroupSection[] {
  return FOOD_GROUPS.map(({ value, label }) => ({
    foodGroup: value,
    label,
    items: items.filter((item) => item.food_group === value).sort(compareExpiry),
  })).filter((section) => section.items.length > 0);
}

export function quantityLabel(item: Item, units: Units = 'us'): string {
  const weightUnits: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 };
  const kgPerUnit = weightUnits[item.unit.trim().toLowerCase()];
  if (kgPerUnit) return formatWeight(item.quantity * kgPerUnit, units);
  const quantity = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return item.unit === 'piece' ? `${quantity} left` : `${quantity} ${item.unit}`;
}

function compareExpiry(a: Item, b: Item): number {
  if (a.predicted_expiry === null) return b.predicted_expiry === null ? a.added_at.localeCompare(b.added_at) : 1;
  if (b.predicted_expiry === null) return -1;
  return a.predicted_expiry.localeCompare(b.predicted_expiry) || a.added_at.localeCompare(b.added_at);
}
