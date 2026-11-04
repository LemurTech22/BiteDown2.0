export type Storage = 'fridge' | 'pantry' | 'freezer';
export type Freshness = 'fresh' | 'semi_fresh' | 'spoiled';
export type FoodGroup =
  | 'protein'
  | 'veggies'
  | 'fruit'
  | 'dairy'
  | 'grains'
  | 'pantry'
  | 'leftovers'
  | 'frozen'
  | 'other';
export type ItemCategory =
  | 'produce_leafy'
  | 'produce_hardy'
  | 'dairy'
  | 'meat'
  | 'seafood'
  | 'bakery'
  | 'eggs'
  | 'leftovers'
  | 'pantry_dry'
  | 'frozen'
  | 'other';
export type ItemSource = 'photo' | 'single_photo' | 'text' | 'barcode' | 'receipt' | 'manual';
export type ExpirySource = 'default' | 'gemini' | 'ml' | 'user';
export type Outcome = 'used' | 'donated' | 'thrown_out';
export type WasteReason = 'expired' | 'didnt_like' | 'forgot' | 'other';
export type ImpactRange = 'week' | 'month' | 'all';

export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AuthMeResponse {
  user: User;
  has_password: boolean;
  providers: string[];
}

export interface Nutrition {
  basis: 'per_100g';
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
  estimated: true;
}

export interface PickupSpot {
  note: string | null;
  lat: number | null;
  lng: number | null;
  place_name: string | null;
}

export interface ShareAudience {
  friends: boolean;
  groups: { id: string; name: string }[];
}

export interface ItemShare {
  id: string;
  status: 'open' | 'fulfilled';
  claimed_by: { id: string; name: string } | null;
  audience: ShareAudience;
  pickup?: PickupSpot | null;
  pickup_set?: boolean;
}

export interface Item {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  category: ItemCategory;
  food_group: FoodGroup;
  storage: Storage;
  quantity: number;
  unit: string;
  est_weight_kg: number | null;
  est_price: number | null;
  source: ItemSource;
  added_at: string;
  predicted_expiry: string | null;
  expiry_source: ExpirySource;
  removed_at: string | null;
  outcome: Outcome | null;
  waste_reason: WasteReason | null;
  removed_after_expiry: boolean | null;
  freshness: Freshness | null;
  freshness_checked_at: string | null;
  confidence: number | null;
  nutrition: Nutrition | null;
  share?: ItemShare | null;
  added_by?: string;
}

export interface ItemCandidate {
  name: string;
  category: ItemCategory;
  food_group: FoodGroup;
  storage: Storage;
  quantity: number;
  unit: string;
  est_price: number | null;
  est_weight_kg?: number | null;
  predicted_expiry: string;
  expiry_source: Exclude<ExpirySource, 'user'>;
  source?: ItemSource;
  freshness?: Freshness;
  confidence?: number | null;
  bbox?: [number, number, number, number] | null;
  nutrition?: Nutrition | null;
  barcode?: string;
  brand?: string;
  quantity_text?: string;
  price?: number | null;
  receipt_text?: string;
}

export interface CreateItemInput {
  name: string;
  category?: ItemCategory;
  food_group?: FoodGroup;
  storage?: Storage;
  quantity?: number;
  unit?: string;
  est_price?: number | null;
  est_weight_kg?: number | null;
  predicted_expiry?: string;
  expiry_source?: ExpirySource;
  source?: ItemSource;
  freshness?: Freshness | null;
  confidence?: number | null;
  nutrition?: Nutrition | null;
  group_id?: string;
}

export interface ItemsQuery {
  storage?: Storage;
  include_removed?: boolean;
  group_by?: 'food_group';
}

export interface ItemsResponse {
  items: Item[];
}

export interface ItemSectionsResponse {
  sections: { food_group: FoodGroup; items: Item[] }[];
}

export interface PhotoCandidatesResponse {
  candidates: ItemCandidate[];
  source: 'yolo' | 'gemini';
  enrichment?: {
    status: 'ok' | 'partial' | 'skipped' | 'failed';
    requested: ('expiry' | 'nutrition')[];
    enriched: number;
    total: number;
    reason: string | null;
  };
}

export interface RemoveItemInput {
  outcome: Outcome;
  waste_reason?: WasteReason;
  recipient_id?: string | null;
}

export interface RemoveBatchInput {
  item_ids: string[];
  outcome: 'used' | 'donated';
  recipient_id?: string | null;
}

export interface ImpactTotals {
  count: number;
  kg: number;
  money: number;
  co2e_kg: number;
}

export interface ImpactPrevious {
  saved: ImpactTotals;
  wasted: ImpactTotals;
  used: ImpactTotals;
  donated: ImpactTotals;
  waste_rate: number;
}

export interface ImpactResponse {
  range: ImpactRange;
  saved: ImpactTotals;
  wasted: ImpactTotals;
  used: ImpactTotals;
  donated: ImpactTotals;
  waste_rate: number;
  waste_reasons: {
    reason: WasteReason;
    count: number;
    kg: number;
    money: number;
    co2e_kg: number;
    share: number;
  }[];
  previous: ImpactPrevious | null;
  weekly: { week: string; saved: number; wasted: number }[];
  last_6_weeks: { week: string; used: number; donated: number; saved: number; wasted: number }[];
}

export interface ReceiptCandidatesResponse {
  candidates: ItemCandidate[];
  total: number | null;
  categorized_by: 'gemini' | 'heuristic';
  source: 'ocr' | 'gemini';
}

export interface Recipe {
  title: string;
  minutes: number;
  servings: number | null;
  uses_items: { item_id: string; name: string; predicted_expiry: string | null }[];
  missing_items: string[];
  steps: string[];
  macros: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  macros_estimated: true;
}

export interface RecipesRequest {
  max_results?: number;
  dietary?: string[];
  item_ids?: string[] | null;
}

export interface ApiClient {
  health(): Promise<{ status: 'ok' }>;
  signup(input: { email: string; password: string; display_name: string }): Promise<AuthResponse>;
  login(input: { email: string; password: string }): Promise<AuthResponse>;
  me(): Promise<AuthMeResponse>;
  deleteMe(): Promise<void>;
  getItems(query?: ItemsQuery): Promise<ItemsResponse | ItemSectionsResponse>;
  createItems(input: { items: CreateItemInput[]; group_id?: string }): Promise<ItemsResponse>;
  fromPhoto(input: {
    uri: string;
    fileName?: string;
    mimeType?: string;
    mode: 'fridge' | 'single';
    enrich?: ('expiry' | 'nutrition')[];
  }): Promise<PhotoCandidatesResponse>;
  removeItem(id: string, input: RemoveItemInput): Promise<{ item: Item }>;
  restoreItem(id: string): Promise<{ item: Item }>;
  removeBatch(input: RemoveBatchInput): Promise<ItemsResponse>;
  restoreBatch(itemIds: string[]): Promise<ItemsResponse>;
  parseText(input: { text: string }): Promise<{ candidates: ItemCandidate[] }>;
  fromReceipt(input: {
    uri: string;
    fileName?: string;
    mimeType?: string;
  }): Promise<ReceiptCandidatesResponse>;
  suggestRecipes(input?: RecipesRequest): Promise<{ recipes: Recipe[] }>;
  getImpact(range?: ImpactRange): Promise<ImpactResponse>;
}
