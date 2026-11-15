import { type CreateItemInput, type ItemCandidate } from '@/api';
import { FoodEditSheet } from '@/components/ui/food-summary';

export interface CandidateDraft {
  id: number;
  candidate: ItemCandidate;
  name: string;
  quantity: string;
  storage: ItemCandidate['storage'];
  expiry: string;
  unit?: string;
  foodGroup?: ItemCandidate['food_group'];
  freshness?: CreateItemInput['freshness'];
  spoilDecision?: 'toss' | 'keep';
}

export function draftError(draft: CandidateDraft): string | undefined {
  if (!draft.name.trim()) return 'Enter a food name.';
  if (!draft.quantity.trim() || !Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0) {
    return 'Enter a quantity greater than zero.';
  }
  if (!(draft.unit ?? draft.candidate.unit).trim()) return 'Enter a unit.';
  if (needsSpoiledDecision(draft)) return 'Choose Toss or Keep for food that looks spoiled.';
  const parsed = new Date(`${draft.expiry}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry) || !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== draft.expiry) return 'Enter a valid expiry date (YYYY-MM-DD).';
}

export function needsSpoiledDecision(draft: CandidateDraft): boolean {
  return effectiveFreshness(draft) === 'spoiled' && !draft.spoilDecision;
}

export function effectiveFreshness(draft: CandidateDraft): CreateItemInput['freshness'] {
  return draft.freshness === undefined ? draft.candidate.freshness : draft.freshness;
}

export function toCreateItem(draft: CandidateDraft, mode: 'fridge' | 'single'): CreateItemInput {
  const { candidate } = draft;
  return {
    name: draft.name.trim(), quantity: Number(draft.quantity), unit: draft.unit ?? candidate.unit,
    storage: draft.storage, predicted_expiry: draft.expiry,
    expiry_source: draft.expiry === candidate.predicted_expiry ? candidate.expiry_source : 'user',
    category: candidate.category, food_group: draft.foodGroup ?? candidate.food_group,
    source: candidate.source ?? (mode === 'single' ? 'single_photo' : 'photo'),
    est_price: candidate.est_price,
    est_weight_kg: Number(draft.quantity) === candidate.quantity && (draft.unit ?? candidate.unit) === candidate.unit ? candidate.est_weight_kg : undefined,
    freshness: effectiveFreshness(draft), confidence: candidate.confidence, nutrition: candidate.nutrition,
    photo_token: candidate.photo_token,
  };
}

export function CandidateEditor({ draft, onChange, onClose, screen }: {
  draft: CandidateDraft; onChange: (patch: Partial<CandidateDraft>) => void; onClose: () => void; screen: string;
}) {
  return <FoodEditSheet field="summary" testID={`${screen}.editor.${draft.id}`} values={{
    name: draft.name, quantity: Number(draft.quantity), unit: draft.unit ?? draft.candidate.unit,
    storage: draft.storage, food_group: draft.foodGroup ?? draft.candidate.food_group,
    predicted_expiry: draft.expiry, freshness: effectiveFreshness(draft),
  }} estimated={draft.expiry === draft.candidate.predicted_expiry} onClose={onClose}
    onSave={async (patch) => onChange({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.quantity !== undefined ? { quantity: String(patch.quantity) } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
      ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
      ...(patch.food_group !== undefined ? { foodGroup: patch.food_group } : {}),
      ...(patch.predicted_expiry !== undefined ? { expiry: patch.predicted_expiry } : {}),
      ...(patch.freshness !== undefined ? { freshness: patch.freshness,
        ...(patch.freshness !== effectiveFreshness(draft) ? { spoilDecision: undefined } : {}) } : {}),
    })} />;
}
