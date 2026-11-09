import type { FoodGroup, FoodRequest, PantryListing } from '@/api';
import { formatWeight, type Units } from '@/settings/preferences';

const CATEGORY_GROUP: Record<PantryListing['item']['category'], FoodGroup> = {
  produce_leafy: 'veggies', produce_hardy: 'veggies', dairy: 'dairy', meat: 'protein', seafood: 'protein',
  bakery: 'grains', eggs: 'protein', leftovers: 'leftovers', pantry_dry: 'pantry', frozen: 'frozen', other: 'other',
};
export function listingGroup(listing: PantryListing): FoodGroup {
  return CATEGORY_GROUP[listing.item.category];
}
export function listingQuantity({ item }: PantryListing, units: Units): string {
  const { quantity, unit } = item;
  if (unit === 'kg') return formatWeight(quantity, units);
  if (unit === 'g') return formatWeight(quantity / 1000, units);
  if (unit === 'lb' || unit === 'lbs') return formatWeight(quantity / 2.2046226218, units);
  if (unit === 'oz') return formatWeight(quantity / 35.27396195, units);
  return `${quantity} ${unit === 'piece' ? (quantity === 1 ? 'piece' : 'pieces') : unit}`;
}
export function expiryLabel(date: string | null, today = new Date()): { label: string; urgent: boolean } | null {
  if (!date) return null;
  const end = Date.parse(date.slice(0, 10));
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  if (!Number.isFinite(end)) return null;
  const days = Math.round((end - start) / 86_400_000);
  if (days < 0) return { label: 'Expired', urgent: true };
  if (days === 0) return { label: 'Today', urgent: true };
  if (days === 1) return { label: 'Tomorrow', urgent: true };
  const label = days <= 7 ? `${days - 1}–${days} days` : days <= 14 ? '1–2 weeks' : days <= 21 ? '2–3 weeks' : '3+ weeks';
  return { label, urgent: false };
}
export function audienceLabel(request: FoodRequest): string {
  return [request.audiences.friends ? 'Friends' : '', ...request.audiences.groups.map((group) => group.name)].filter(Boolean).join(', ');
}
export function hiddenAudienceLabel(count: number): string {
  return `+${count} other ${count === 1 ? 'group' : 'groups'}`;
}
export function requestAge(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 2880) return 'Yesterday';
  return `${Math.floor(minutes / 1440)}d ago`;
}
