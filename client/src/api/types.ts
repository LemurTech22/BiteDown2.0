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
  photo_url: string | null;
  share?: ItemShare | null;
  added_by?: string;
}

export interface ItemCandidate {
  photo_token?: string | null;
  photo_preview_url?: string | null;
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
  brand?: string | null;
  quantity_text?: string | null;
  price?: number | null;
  receipt_text?: string;
}

export interface CreateItemInput {
  photo_token?: string | null;
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

export type UpdateItemInput = Partial<Pick<CreateItemInput,
  'name' | 'quantity' | 'unit' | 'storage' | 'category' | 'food_group' | 'predicted_expiry' |
  'est_price' | 'est_weight_kg' | 'freshness'>> & { reestimate_expiry?: boolean };

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

export interface Tip {
  code: string;
  message: string;
}

export type SocialStatus = 'open' | 'fulfilled' | 'cancelled';
export interface ShareListing {
  id: string;
  item_id: string;
  owner_id: string;
  group_id: string | null;
  status: SocialStatus;
  recipient_id: string | null;
  claimed_by: string | null;
  created_at: string;
  fulfilled_at: string | null;
  pickup: PickupSpot | null;
  pickup_set: boolean;
}

export interface PantryListing {
  id: string;
  item_id: string;
  owner_id: string;
  owner_name: string;
  group_id: string | null;
  status: 'open';
  claimed_by_me: boolean;
  created_at: string;
  source: { type: 'friend' | 'group'; name: string };
  item: Pick<Item, 'name' | 'category' | 'quantity' | 'unit' | 'predicted_expiry' | 'photo_url'>;
  pickup: PickupSpot | null;
  pickup_set: boolean;
}

export interface CreateShareInput {
  item_id: string;
  group_id?: string;
  pickup?: Partial<PickupSpot> | null;
}
export interface UpdateShareInput {
  pickup: Partial<PickupSpot> | null;
}
export interface Friend {
  user_id: string;
  display_name: string;
  status: 'pending' | 'accepted';
  created_at: string;
}
export interface FriendsResponse {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}
export interface FriendCode {
  code: string;
  expires_at: string;
  url: string;
}
export type AddFriendInput = { code: string; email?: never } | { email: string; code?: never };
export interface Group {
  id: string;
  name: string;
  role: 'owner' | 'member';
  member_count: number;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}
export interface GroupDetail extends Group {
  members: { user_id: string; display_name: string; role: 'owner' | 'member'; joined_at: string }[];
}
export interface FoodRequest {
  id: string;
  author_id: string;
  author_name: string;
  text: string;
  status: SocialStatus;
  fulfilled_by: string | null;
  fulfilled_by_name: string | null;
  created_at: string;
  audiences: ShareAudience & { hidden_count: number };
  source: { type: 'me' | 'friend' | 'group'; name: string };
  group_id: string | null;
  group_name: string | null;
}
export interface CreateRequestInput {
  text: string;
  audiences: { friends?: boolean; group_ids?: string[] };
}
export interface RequestsQuery {
  mine?: boolean;
}
export interface ReachablePerson {
  id: string;
  display_name: string;
  kind: 'friend' | 'group_member';
  groups: { id: string; name: string }[];
  is_claimer: boolean;
}

export interface ApiClient {
  health(): Promise<{ status: 'ok' }>;
  signup(input: { email: string; password: string; display_name: string }): Promise<AuthResponse>;
  login(input: { email: string; password: string }): Promise<AuthResponse>;
  me(): Promise<AuthMeResponse>;
  deleteMe(): Promise<void>;
  getItems(query?: ItemsQuery): Promise<ItemsResponse | ItemSectionsResponse>;
  createItems(input: { items: CreateItemInput[]; group_id?: string }): Promise<ItemsResponse>;
  updateItem(id: string, patch: UpdateItemInput): Promise<{ item: Item }>;
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
  getBarcode(code: string): Promise<{ candidate: ItemCandidate }>;
  getTips(): Promise<{ tips: Tip[] }>;
  getShare(): Promise<{ listings: PantryListing[] }>;
  createShare(input: CreateShareInput): Promise<{ listing: ShareListing }>;
  updateShare(id: string, input: UpdateShareInput): Promise<{ listing: ShareListing }>;
  deleteShare(id: string): Promise<{ listing: ShareListing }>;
  claimShare(id: string): Promise<{ listing: ShareListing }>;
  getFriends(): Promise<FriendsResponse>;
  getFriendCode(): Promise<FriendCode>;
  addFriend(input: AddFriendInput): Promise<{ friend: Friend }>;
  acceptFriend(id: string): Promise<{ friend: Friend }>;
  deleteFriend(id: string): Promise<void>;
  getGroups(): Promise<{ groups: Group[] }>;
  createGroup(input: { name: string }): Promise<{ group: Group }>;
  joinGroup(input: { invite_code: string }): Promise<{ group: Group }>;
  getGroup(id: string): Promise<{ group: GroupDetail }>;
  getGroupPantry(id: string): Promise<ItemsResponse>;
  leaveGroup(id: string): Promise<{ left: true }>;
  getRequests(query?: RequestsQuery): Promise<{ requests: FoodRequest[] }>;
  createRequest(input: CreateRequestInput): Promise<{ request: FoodRequest }>;
  deleteRequest(id: string): Promise<{ request: FoodRequest }>;
  fulfilRequest(id: string): Promise<{ request: FoodRequest }>;
  getReachablePeople(itemId?: string): Promise<{ people: ReachablePerson[] }>;
}
