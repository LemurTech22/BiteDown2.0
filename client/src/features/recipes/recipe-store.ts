import type { ApiClient, Recipe } from '@/api';

export interface StoredRecipe { key: string; recipe: Recipe }
interface RecipeResult { entries: StoredRecipe[]; usedIds: Set<string> }
const results = new WeakMap<ApiClient, RecipeResult>();
let sequence = 0;

// Suggestions have no server id. Keep only the latest result, isolated by client/session.
export function rememberRecipes(api: ApiClient, recipes: Recipe[]): StoredRecipe[] {
  const generation = ++sequence;
  const entries = recipes.slice(0, 10).map((recipe, index) => ({ key: generation + '-' + index, recipe }));
  const previous = results.get(api)?.usedIds;
  const ids = new Set(entries.flatMap(({ recipe }) => recipe.uses_items.map((item) => item.item_id)));
  const usedIds = new Set([...previous ?? []].filter((id) => ids.has(id)));
  results.set(api, { entries, usedIds });
  return entries;
}

export function getRecipe(api: ApiClient, key: string): Recipe | undefined {
  return results.get(api)?.entries.find((entry) => entry.key === key)?.recipe;
}

export function usedRecipeItemIds(api: ApiClient): Set<string> {
  return new Set(results.get(api)?.usedIds);
}

export function markRecipeItemUsed(api: ApiClient, id: string): void {
  results.get(api)?.usedIds.add(id);
}
