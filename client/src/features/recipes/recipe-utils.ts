import type { Recipe } from '@/api';
import type { StoredRecipe } from './recipe-store';

export function expiryPresentation(expiry: string | null, now = new Date()): { label: string | null; urgent: boolean } {
  if (!expiry) return { label: null, urgent: false };
  const date = new Date(expiry.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime())) return { label: null, urgent: false };
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((date.getTime() - today) / 86_400_000);
  if (days < 0) return { label: 'Expired', urgent: true };
  if (days === 0) return { label: 'Today', urgent: true };
  if (days === 1) return { label: 'Tomorrow', urgent: true };
  if (days <= 3) return { label: '2–3 days', urgent: false };
  if (days <= 5) return { label: '4–5 days', urgent: false };
  if (days <= 7) return { label: '6–7 days', urgent: false };
  if (days <= 14) return { label: '1–2 weeks', urgent: false };
  if (days <= 21) return { label: '2–3 weeks', urgent: false };
  return { label: '3+ weeks', urgent: false };
}

export function recipeMeta(recipe: Recipe): string {
  return [recipe.minutes + ' min', recipe.servings ? recipe.servings + (recipe.servings === 1 ? ' serving' : ' servings') : null]
    .filter(Boolean).join(' · ');
}

export function visibleRecipes(entries: StoredRecipe[], onlyHave: boolean, quick: boolean, expiring: boolean): StoredRecipe[] {
  const visible = entries.filter(({ recipe }) => (!onlyHave || recipe.missing_items.length === 0) && (!quick || recipe.minutes < 30));
  if (!expiring) return visible;
  return visible.sort((a, b) => soonestExpiry(a.recipe).localeCompare(soonestExpiry(b.recipe)));
}

function soonestExpiry(recipe: Recipe): string {
  return recipe.uses_items.map((item) => item.predicted_expiry).filter((date): date is string => Boolean(date)).sort()[0] ?? '9999';
}
