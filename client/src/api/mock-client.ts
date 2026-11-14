import { ApiError } from './errors';
import type {
  AddFriendInput,
  ApiClient,
  AuthMeResponse,
  AuthResponse,
  CreateItemInput,
  CreateRequestInput,
  CreateShareInput,
  FoodGroup,
  FoodRequest,
  Friend,
  FriendCode,
  FriendsResponse,
  Group,
  GroupDetail,
  ImpactRange,
  ImpactResponse,
  ImpactTotals,
  Item,
  ItemCandidate,
  ItemCategory,
  ItemSectionsResponse,
  ItemsQuery,
  ItemsResponse,
  Outcome,
  PantryListing,
  PhotoCandidatesResponse,
  PickupSpot,
  ReachablePerson,
  ReceiptCandidatesResponse,
  Recipe,
  RecipesRequest,
  RemoveBatchInput,
  RemoveItemInput,
  RequestsQuery,
  ShareListing,
  Storage,
  Tip,
  UpdateItemInput,
  UpdateShareInput,
  User,
  WasteReason,
} from './types';

interface MockUser extends User {
  password: string;
}

interface MockEvent {
  itemId: string;
  outcome: Outcome;
  reason: WasteReason | null;
  kg: number;
  money: number;
  co2eKg: number;
  at: string;
}

interface SocialState {
  friends: FriendsResponse;
  groups: GroupDetail[];
  memberships: Set<string>;
  pantry: Item[];
  listings: ShareListing[];
  requests: FoodRequest[];
  code: FriendCode | null;
}

const DEMO_PEOPLE = [
  { id: 'friend-ana', display_name: 'Ana Rivera', email: 'ana@example.com', code: 'AnaDemoCode123456' },
  { id: 'friend-ben', display_name: 'Ben Chen', email: 'ben@example.com', code: 'BenDemoCode123456' },
  { id: 'friend-dana', display_name: 'Dana Whitfield', email: 'dana@example.com', code: 'DanaDemoCode12345' },
  { id: 'friend-eli', display_name: 'Eli Brooks', email: 'eli@example.com', code: 'EliDemoCode123456' },
];

const FOOD_GROUP_ORDER: FoodGroup[] = [
  'protein',
  'veggies',
  'fruit',
  'dairy',
  'grains',
  'pantry',
  'leftovers',
  'frozen',
  'other',
];
const WASTE_REASONS: WasteReason[] = ['expired', 'didnt_like', 'forgot', 'other'];

export class MockApiClient implements ApiClient {
  private readonly users = new Map<string, MockUser>();
  private items: Item[] = [];
  private events: MockEvent[] = [];
  private currentUser: MockUser | null = null;
  private token: string | null = null;
  private sequence = 0;
  private readonly socialByUser = new Map<string, SocialState>();
  private readonly friendCodes = new Map<string, { owner_id: string; expires_at: string }>();

  async health() {
    return { status: 'ok' as const };
  }

  async signup(input: { email: string; password: string; display_name: string }): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();
    if (input.password.length < 8 || input.password.length > 256 || !email || !input.display_name.trim()) {
      throw new ApiError(400, 'validation_error', 'Check your details and try again.');
    }
    if (this.users.has(email)) throw new ApiError(409, 'email_taken', 'An account already uses that email.');
    const user: MockUser = {
      id: this.id('user'),
      email,
      display_name: input.display_name.trim(),
      created_at: new Date().toISOString(),
      password: input.password,
    };
    this.users.set(email, user);
    this.currentUser = user;
    this.token = this.id('token');
    return { token: this.token, user: publicUser(user) };
  }

  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const user = this.users.get(input.email.trim().toLowerCase());
    if (!user || user.password !== input.password) {
      throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    this.currentUser = user;
    this.token = this.id('token');
    return { token: this.token, user: publicUser(user) };
  }

  async me(): Promise<AuthMeResponse> {
    const user = this.requireUser();
    return { user: publicUser(user), has_password: true, providers: [] };
  }

  async deleteMe(): Promise<void> {
    const user = this.requireUser();
    this.users.delete(user.email);
    this.items = [];
    this.events = [];
    this.socialByUser.delete(user.id);
    this.currentUser = null;
    this.token = null;
  }

  async getItems(query: ItemsQuery = {}): Promise<ItemsResponse | ItemSectionsResponse> {
    this.requireUser();
    const items = this.items
      .filter((item) => item.group_id === null)
      .filter((item) => !query.storage || item.storage === query.storage)
      .filter((item) => query.include_removed === true || item.removed_at === null)
      .sort(compareItems)
      .map(copy);
    if (query.group_by === 'food_group') {
      const sections = FOOD_GROUP_ORDER.map((food_group) => ({
        food_group,
        items: items.filter((item) => item.food_group === food_group),
      })).filter((section) => section.items.length > 0);
      return { sections };
    }
    return { items };
  }

  async createItems(input: { items: CreateItemInput[]; group_id?: string }): Promise<ItemsResponse> {
    const user = this.requireUser();
    if (input.items.length < 1 || input.items.length > 100) {
      throw new ApiError(400, 'validation_error', 'Add between 1 and 100 items.');
    }
    const added = input.items.map((candidate) => {
      const now = new Date().toISOString();
      const freshness = candidate.freshness ?? null;
      const item: Item = {
        id: this.id('item'),
        owner_id: user.id,
        group_id: candidate.group_id ?? input.group_id ?? null,
        name: candidate.name,
        category: candidate.category ?? 'other',
        food_group: candidate.food_group ?? 'other',
        storage: candidate.storage ?? 'fridge',
        quantity: candidate.quantity ?? 1,
        unit: candidate.unit ?? 'piece',
        est_weight_kg: candidate.est_weight_kg ?? 0.2 * (candidate.quantity ?? 1),
        est_price: candidate.est_price ?? null,
        source: candidate.source ?? 'manual',
        added_at: now,
        predicted_expiry: candidate.predicted_expiry ?? dateFromNow(7),
        expiry_source: candidate.predicted_expiry ? candidate.expiry_source ?? 'user' : 'default',
        removed_at: null,
        outcome: null,
        waste_reason: null,
        removed_after_expiry: null,
        freshness,
        freshness_checked_at: freshness ? now : null,
        confidence: candidate.confidence ?? null,
        nutrition: candidate.nutrition ?? null,
        share: null,
      };
      this.items.push(item);
      return copy(item);
    });
    return { items: added };
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<{ item: Item }> {
    const user = this.requireUser();
    const item = this.findItem(id);
    if (item.removed_at) throw new ApiError(404, 'not_found', 'Item not found.');
    if (item.owner_id !== user.id) throw new ApiError(403, 'forbidden', 'That item belongs to another user.');
    if ('reestimate_expiry' in patch && typeof patch.reestimate_expiry !== 'boolean') {
      fail(400, 'validation_error', 'reestimate_expiry must be a boolean.');
    }
    const { reestimate_expiry, ...fields } = patch;
    const oldStorage = item.storage;
    const oldExpiry = item.predicted_expiry;
    Object.assign(item, fields);
    if ('predicted_expiry' in patch) {
      if (item.predicted_expiry !== oldExpiry) item.expiry_source = 'user';
    } else if ('storage' in patch && item.storage !== oldStorage && (item.expiry_source !== 'user' || reestimate_expiry === true)) {
      item.predicted_expiry = reestimateExpiry(item.category, oldStorage, item.storage, oldExpiry);
      item.expiry_source = 'default';
    }
    if (patch.freshness !== undefined) item.freshness_checked_at = patch.freshness === null ? null : new Date().toISOString();
    if (patch.est_weight_kg === undefined && (patch.quantity !== undefined || patch.unit !== undefined || patch.category !== undefined)) {
      item.est_weight_kg = 0.2 * item.quantity;
    }
    return { item: copy(item) };
  }

  async fromPhoto(input: {
    uri: string;
    fileName?: string;
    mimeType?: string;
    mode: 'fridge' | 'single';
    enrich?: ('expiry' | 'nutrition')[];
  }): Promise<PhotoCandidatesResponse> {
    this.requireUser();
    const candidate: ItemCandidate = {
      name: input.mode === 'single' ? 'Mock apple' : 'Mock apples',
      category: 'produce_hardy',
      food_group: 'fruit',
      storage: 'fridge',
      quantity: 1,
      unit: 'piece',
      est_price: 1.2,
      est_weight_kg: 0.2,
      predicted_expiry: dateFromNow(5),
      expiry_source: 'default',
      source: input.mode === 'single' ? 'single_photo' : 'photo',
      freshness: 'fresh',
      confidence: 0.95,
      bbox: null,
      nutrition: null,
    };
    return { candidates: [candidate], source: 'yolo' };
  }

  async removeItem(id: string, input: RemoveItemInput): Promise<{ item: Item }> {
    this.requireUser();
    validateRemoval(input);
    const item = this.findItem(id);
    if (item.removed_at) throw new ApiError(409, 'already_removed', 'That item was already removed.');
    const now = new Date().toISOString();
    item.removed_at = now;
    item.outcome = input.outcome;
    item.waste_reason = input.outcome === 'thrown_out' ? input.waste_reason ?? null : null;
    item.removed_after_expiry = item.predicted_expiry !== null && now.slice(0, 10) > item.predicted_expiry;
    this.events.push(eventFor(item, now));
    const listing = this.socialByUser.get(this.requireUser().id)?.listings.find((entry) => entry.item_id === id && entry.status === 'open');
    if (listing && input.outcome === 'donated') {
      listing.status = 'fulfilled';
      listing.fulfilled_at = now;
      listing.recipient_id = 'recipient_id' in input ? input.recipient_id ?? null : listing.claimed_by;
      this.syncItemShare(listing);
    }
    return { item: copy(item) };
  }

  async restoreItem(id: string): Promise<{ item: Item }> {
    this.requireUser();
    const item = this.findItem(id);
    if (!item.removed_at || !item.outcome) throw new ApiError(409, 'not_removed', 'That item is still active.');
    if (Date.now() - Date.parse(item.removed_at) >= 10 * 60 * 1000) {
      throw new ApiError(409, 'restore_window_expired', 'The 10-minute undo window has expired.');
    }
    const listing = this.socialByUser.get(this.requireUser().id)?.listings.find((entry) => entry.item_id === id && entry.status === 'fulfilled' && entry.fulfilled_at === item.removed_at);
    if (listing) {
      listing.status = 'open';
      listing.fulfilled_at = null;
      listing.recipient_id = null;
      this.syncItemShare(listing);
    }
    this.events = this.events.filter((event) => event.itemId !== item.id);
    item.removed_at = null;
    item.outcome = null;
    item.waste_reason = null;
    item.removed_after_expiry = null;
    return { item: copy(item) };
  }

  async removeBatch(input: RemoveBatchInput): Promise<ItemsResponse> {
    this.requireUser();
    if (input.item_ids.length < 1 || new Set(input.item_ids).size !== input.item_ids.length) {
      throw new ApiError(400, 'validation_error', 'Choose unique items to remove.');
    }
    const snapshot = copy(this.items);
    const eventSnapshot = copy(this.events);
    const socialState = this.socialByUser.get(this.requireUser().id);
    const listingSnapshot = socialState ? copy(socialState.listings) : null;
    try {
      const items: Item[] = [];
      for (const id of input.item_ids) {
        const result = await this.removeItem(id, {
          outcome: input.outcome,
          ...(input.recipient_id !== undefined ? { recipient_id: input.recipient_id } : {}),
        });
        items.push(result.item);
      }
      return { items };
    } catch (error) {
      this.items = snapshot;
      this.events = eventSnapshot;
      if (socialState && listingSnapshot) socialState.listings = listingSnapshot;
      throw error;
    }
  }

  async restoreBatch(itemIds: string[]): Promise<ItemsResponse> {
    this.requireUser();
    const snapshot = copy(this.items);
    const eventSnapshot = copy(this.events);
    const socialState = this.socialByUser.get(this.requireUser().id);
    const listingSnapshot = socialState ? copy(socialState.listings) : null;
    try {
      const items: Item[] = [];
      for (const id of itemIds) items.push((await this.restoreItem(id)).item);
      return { items };
    } catch (error) {
      this.items = snapshot;
      this.events = eventSnapshot;
      if (socialState && listingSnapshot) socialState.listings = listingSnapshot;
      throw error;
    }
  }

  async parseText(input: { text: string }): Promise<{ candidates: ItemCandidate[] }> {
    this.requireUser();
    if (!input.text.trim()) throw new ApiError(400, 'validation_error', 'Enter some food first.');
    return {
      candidates: [{
        name: input.text.trim().slice(0, 200),
        category: 'other',
        food_group: 'other',
        storage: 'fridge',
        quantity: 1,
        unit: 'piece',
        est_price: null,
        est_weight_kg: 0.2,
        predicted_expiry: dateFromNow(7),
        expiry_source: 'default',
        source: 'text',
        freshness: 'fresh',
        confidence: null,
        nutrition: null,
      }],
    };
  }

  async fromReceipt(_input: { uri: string; fileName?: string; mimeType?: string }): Promise<ReceiptCandidatesResponse> {
    this.requireUser();
    const parsed = await this.parseText({ text: 'Mock receipt item' });
    return {
      candidates: [
        ...parsed.candidates.map((candidate) => ({ ...candidate, source: 'receipt' as const, price: 2.5, est_price: 2.5, receipt_text: 'MOCK FOOD 2.50' })),
        { ...parsed.candidates[0], name: 'Paper towels', category: 'other', food_group: 'other', storage: 'pantry', source: 'receipt', price: 3, est_price: 3, receipt_text: 'PAPER TOWELS 3.00' },
      ],
      total: 5.5,
      categorized_by: 'heuristic',
      source: 'ocr',
    };
  }

  async suggestRecipes(input: RecipesRequest = {}): Promise<{ recipes: Recipe[] }> {
    this.requireUser();
    const available = this.items.filter((item) => item.removed_at === null && item.group_id === null);
    const focused = input.item_ids?.length
      ? available.filter((item) => input.item_ids?.includes(item.id))
      : available;
    if (focused.length === 0) return { recipes: [] };
    const count = input.max_results ?? 3;
    const recipes: Recipe[] = focused.slice(0, count).map((item) => ({
      title: `Mock ${item.name} meal`,
      minutes: 20,
      servings: 2,
      uses_items: [{ item_id: item.id, name: item.name, predicted_expiry: item.predicted_expiry }],
      missing_items: [],
      steps: ['Prepare the ingredients.', 'Cook and serve.'],
      macros: null,
      macros_estimated: true,
    }));
    return { recipes };
  }

  async getImpact(range: ImpactRange = 'all'): Promise<ImpactResponse> {
    this.requireUser();
    const cutoff = range === 'week' ? 7 : range === 'month' ? 30 : null;
    const events = this.events.filter((event) => cutoff === null || Date.parse(event.at) >= Date.now() - cutoff * 86_400_000);
    const used = totals(events.filter((event) => event.outcome === 'used'));
    const donated = totals(events.filter((event) => event.outcome === 'donated'));
    const wasted = totals(events.filter((event) => event.outcome === 'thrown_out'));
    const saved = addTotals(used, donated);
    const reasons = WASTE_REASONS.map((reason) => {
      const reasonTotals = totals(events.filter((event) => event.reason === reason));
      return {
        reason,
        ...reasonTotals,
        share: wasted.count ? reasonTotals.count / wasted.count : 0,
      };
    }).sort((a, b) => b.count - a.count || WASTE_REASONS.indexOf(a.reason) - WASTE_REASONS.indexOf(b.reason));
    const empty = zeroTotals();
    return {
      range,
      saved,
      wasted,
      used,
      donated,
      waste_rate: saved.count + wasted.count ? wasted.count / (saved.count + wasted.count) : 0,
      waste_reasons: reasons,
      previous: range === 'all'
        ? null
        : { saved: empty, wasted: empty, used: empty, donated: empty, waste_rate: 0 },
      weekly: weeklyCounts(events),
      last_6_weeks: lastSixWeeks(this.events),
    };
  }


  async getBarcode(code: string): Promise<{ candidate: ItemCandidate }> {
    this.requireUser();
    if (!/^\d{6,14}$/.test(code)) fail(400, 'validation_error', 'Barcode must be 6-14 digits.');
    if (code !== '012345678905') fail(404, 'not_found', 'No product found for that barcode.');
    return { candidate: { ...(await this.parseText({ text: 'Whole grain cereal' })).candidates[0],
      category: 'pantry_dry', food_group: 'grains', storage: 'pantry', source: 'barcode',
      barcode: code, brand: 'BiteDown Market', quantity_text: '500 g' } };
  }

  async getTips(): Promise<{ tips: Tip[] }> {
    const user = this.requireUser();
    const active = this.items.filter((item) => item.owner_id === user.id && !item.removed_at &&
      (!item.group_id || this.social().memberships.has(item.group_id)));
    const tips: Tip[] = [];
    const past = active.filter((item) => item.predicted_expiry && item.predicted_expiry < dateFromNow(0));
    const soon = active.filter((item) => item.predicted_expiry && item.predicted_expiry >= dateFromNow(0) && item.predicted_expiry <= dateFromNow(2));
    if (past.length) tips.push({ code: 'past_expiry', message: `${past.length} items are past their expiry date and still logged as in stock.` });
    if (soon.length) tips.push({ code: 'expiring_soon', message: `${soon.length} items expire within 2 days.` });
    const impact = await this.getImpact('month');
    if (impact.wasted.count) tips.push({ code: 'top_wasted_category', message: `${impact.wasted.count} items were thrown out in the last 30 days.` });
    if (impact.saved.count) tips.push({ code: 'saved_recent', message: `You used or donated ${impact.saved.count} items in the last 30 days.` });
    return { tips: tips.length ? tips : [{ code: 'getting_started', message: 'Nothing used, donated or thrown out in the last 30 days.' }] };
  }

  async getShare(): Promise<{ listings: PantryListing[] }> {
    const user = this.requireUser();
    return { listings: this.allListings().filter((listing) => this.listingVisible(listing) &&
      listing.owner_id !== user.id && listing.status === 'open' && (!listing.claimed_by || listing.claimed_by === user.id))
      .filter((listing) => !this.socialItem(listing.item_id).removed_at)
      .sort(newestFirst).map((listing) => {
        const item = this.socialItem(listing.item_id);
        const owner = this.personName(listing.owner_id);
        return { id: listing.id, item_id: item.id, owner_id: listing.owner_id, owner_name: owner,
          group_id: listing.group_id, status: 'open', claimed_by_me: listing.claimed_by === user.id,
          created_at: listing.created_at,
          source: listing.group_id ? { type: 'group', name: this.memberGroup(listing.group_id).name } : { type: 'friend', name: owner },
          item: { name: item.name, category: item.category, quantity: item.quantity, unit: item.unit, predicted_expiry: item.predicted_expiry },
          pickup: listing.claimed_by === user.id ? copy(listing.pickup) : null, pickup_set: listing.pickup_set };
      }) };
  }

  async createShare(input: CreateShareInput): Promise<{ listing: ShareListing }> {
    const user = this.requireUser();
    const item = this.findItem(input.item_id);
    if (item.owner_id !== user.id) fail(403, 'forbidden', 'This item belongs to another user.');
    if (item.removed_at) fail(409, 'already_removed', 'Item has already been removed.');
    if (item.group_id) fail(400, 'validation_error', 'Group pantry items cannot be shared.');
    if (input.group_id) this.memberGroup(input.group_id);
    const state = this.social();
    if (state.listings.some((listing) => listing.item_id === item.id && listing.status === 'open')) fail(409, 'already_shared', 'Item already has an open listing.');
    const pickup = normalizePickup(input.pickup ?? null);
    const listing: ShareListing = { id: this.id('listing'), item_id: item.id, owner_id: user.id,
      group_id: input.group_id ?? null, status: 'open', recipient_id: null, claimed_by: null,
      created_at: new Date().toISOString(), fulfilled_at: null, pickup, pickup_set: pickup !== null };
    state.listings.push(listing);
    this.syncItemShare(listing);
    return { listing: copy(listing) };
  }

  async updateShare(id: string, input: UpdateShareInput) {
    const listing = this.ownedOpenListing(id);
    if (!('pickup' in input)) fail(400, 'validation_error', 'Pickup is required.');
    listing.pickup = normalizePickup(input.pickup);
    listing.pickup_set = listing.pickup !== null;
    this.syncItemShare(listing);
    return { listing: copy(listing) };
  }

  async deleteShare(id: string) {
    const listing = this.ownedOpenListing(id);
    listing.status = 'cancelled';
    this.syncItemShare(listing);
    return { listing: copy(listing) };
  }

  async claimShare(id: string) {
    const listing = this.visibleListing(id);
    if (listing.owner_id === this.requireUser().id) fail(400, 'validation_error', 'You cannot claim your own listing.');
    if (listing.status !== 'open' || this.socialItem(listing.item_id).removed_at) fail(409, 'listing_closed', 'Listing is closed.');
    if (listing.claimed_by) fail(409, 'already_claimed', 'Someone has already claimed this listing.');
    listing.claimed_by = this.requireUser().id;
    if (this.items.some((item) => item.id === listing.item_id)) this.syncItemShare(listing);
    return { listing: copy(listing) };
  }

  async getFriends() { return copy(this.social().friends); }

  async getFriendCode() {
    const state = this.social();
    if (!state.code || Date.parse(state.code.expires_at) - Date.now() < 120_000) {
      const code = this.id('code').padEnd(16, 'x');
      state.code = { code, expires_at: new Date(Date.now() + 600_000).toISOString(), url: `bitedown://friend/${code}` };
      this.friendCodes.set(code, { owner_id: this.requireUser().id, expires_at: state.code.expires_at });
    }
    return copy(state.code);
  }

  async addFriend(input: AddFriendInput): Promise<{ friend: Friend }> {
    const user = this.requireUser();
    const state = this.social();
    if (Boolean(input.code) === Boolean(input.email)) fail(400, 'validation_error', 'Provide exactly one of code or email.');
    const email = input.email?.trim().toLowerCase();
    if (email === user.email || (input.code && input.code === state.code?.code)) fail(400, 'validation_error', 'You cannot add yourself.');
    const codeRecord = input.code ? this.friendCodes.get(input.code) : undefined;
    const codeOwner = codeRecord && Date.parse(codeRecord.expires_at) > Date.now() ? codeRecord.owner_id : undefined;
    if (codeOwner === user.id) fail(400, 'validation_error', 'You cannot add yourself.');
    const target = DEMO_PEOPLE.find((person) => input.code ? person.code === input.code : person.email === email)
      ?? [...this.users.values()].find((person) => input.code ? person.id === codeOwner : person.email === email);
    if (!target) fail(input.code ? 400 : 404, input.code ? 'invalid_code' : 'not_found', input.code ? 'That code is not valid any more.' : 'No account uses that email.');
    const targetId = target.id;
    const existing = [...state.friends.friends, ...state.friends.incoming, ...state.friends.outgoing].find((friend) => friend.user_id === targetId);
    if (existing && !input.code) fail(409, existing.status === 'accepted' ? 'already_friends' : 'request_pending', 'A relationship already exists.');
    if (existing?.status === 'accepted') return { friend: copy(existing) };
    const friend: Friend = existing ?? { user_id: targetId, display_name: target.display_name, status: 'pending', created_at: new Date().toISOString() };
    if (input.code) {
      state.friends.incoming = state.friends.incoming.filter((entry) => entry.user_id !== targetId);
      state.friends.outgoing = state.friends.outgoing.filter((entry) => entry.user_id !== targetId);
      friend.status = 'accepted';
      state.friends.friends.push(friend);
    } else state.friends.outgoing.push(friend);
    this.mirrorFriend(targetId, input.code ? 'accepted' : 'pending');
    return { friend: copy(friend) };
  }

  async acceptFriend(id: string) {
    const friends = this.social().friends;
    const friend = friends.incoming.find((entry) => entry.user_id === id);
    if (!friend) fail(404, 'not_found', 'Pending friend request not found.');
    friends.incoming = friends.incoming.filter((entry) => entry !== friend);
    friend.status = 'accepted';
    friends.friends.push(friend);
    this.mirrorFriend(id, 'accepted');
    return { friend: copy(friend) };
  }

  async deleteFriend(id: string): Promise<void> {
    const friends = this.social().friends;
    if (![...friends.friends, ...friends.incoming, ...friends.outgoing].some((entry) => entry.user_id === id)) fail(404, 'not_found', 'Friend not found.');
    for (const key of ['friends', 'incoming', 'outgoing'] as const) friends[key] = friends[key].filter((entry) => entry.user_id !== id);
    this.mirrorFriend(id, null);
  }

  async getGroups(): Promise<{ groups: Group[] }> {
    return { groups: this.social().groups.filter((group) => this.social().memberships.has(group.id)).map((group) => this.groupView(group)) };
  }

  async createGroup(input: { name: string }): Promise<{ group: Group }> {
    const user = this.requireUser();
    if (!input.name.trim() || input.name.trim().length > 60) fail(400, 'validation_error', 'Name must be 1-60 characters.');
    const now = new Date().toISOString();
    const group: GroupDetail = { id: this.id('group'), name: input.name.trim(), role: 'owner', member_count: 1,
      invite_code: makeInviteCode(this.sequence),
      created_by: user.id, created_at: now, members: [{ user_id: user.id, display_name: user.display_name, role: 'owner', joined_at: now }] };
    this.social().groups.push(group);
    this.social().memberships.add(group.id);
    return { group: groupSummary(group) };
  }

  async joinGroup(input: { invite_code: string }): Promise<{ group: Group }> {
    const state = this.social();
    const group = this.allGroups().find((entry) => entry.invite_code === input.invite_code.replace(/[\s-]/g, '').toUpperCase());
    if (!group) fail(404, 'not_found', 'No group with that invite code.');
    if (state.memberships.has(group.id)) fail(409, 'already_member', 'You are already in this group.');
    const user = this.requireUser();
    group.members.push({ user_id: user.id, display_name: user.display_name, role: group.members.length ? 'member' : 'owner', joined_at: new Date().toISOString() });
    group.role = group.members[group.members.length - 1].role;
    group.member_count = group.members.length;
    state.memberships.add(group.id);
    if (!state.groups.includes(group)) state.groups.push(group);
    return { group: this.groupView(group) };
  }

  async getGroup(id: string) {
    const group = this.memberGroup(id);
    return { group: { ...this.groupView(group), members: copy(group.members) } };
  }

  async getGroupPantry(id: string): Promise<ItemsResponse> {
    this.memberGroup(id);
    return { items: [...this.social().pantry, ...this.items].filter((item) => item.group_id === id && !item.removed_at)
      .sort(compareItems).map((item) => ({ ...copy(item), added_by: this.personName(item.owner_id) })) };
  }

  async leaveGroup(id: string): Promise<{ left: true }> {
    const user = this.requireUser();
    const group = this.memberGroup(id);
    group.members = group.members.filter((member) => member.user_id !== user.id);
    if (!group.members.some((member) => member.role === 'owner') && group.members[0]) group.members[0].role = 'owner';
    group.member_count = group.members.length;
    const state = this.social();
    state.memberships.delete(id);
    for (const listing of state.listings) if (listing.group_id === id && listing.owner_id === user.id && listing.status === 'open') {
      listing.status = 'cancelled';
      this.syncItemShare(listing);
    }
    for (const request of state.requests) if (request.author_id === user.id && request.status === 'open' && request.audiences.groups.some((entry) => entry.id === id)) {
      if (!request.audiences.friends && request.audiences.groups.length === 1) request.status = 'cancelled';
      else request.audiences.groups = request.audiences.groups.filter((entry) => entry.id !== id);
    }
    return { left: true };
  }

  async getRequests(query: RequestsQuery = {}): Promise<{ requests: FoodRequest[] }> {
    const uid = this.requireUser().id;
    return { requests: this.allRequests().filter((request) => query.mine ? request.author_id === uid : request.status === 'open' && this.requestVisible(request))
      .sort(newestFirst).map((request) => this.requestView(request)) };
  }

  async createRequest(input: CreateRequestInput) {
    const user = this.requireUser();
    const text = input.text.trim();
    const ids = [...new Set(input.audiences.group_ids ?? [])];
    if (!text || text.length > 280 || (!input.audiences.friends && !ids.length) || (input.audiences.group_ids?.length ?? 0) > 50) fail(400, 'validation_error', 'Enter a note and choose an audience.');
    const groups = ids.map((id) => {
      if (!this.social().memberships.has(id)) fail(404, 'not_found', 'Group not found.');
      const group = this.memberGroup(id);
      return { id, name: group.name };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const request: FoodRequest = { id: this.id('request'), author_id: user.id, author_name: user.display_name,
      text, status: 'open', fulfilled_by: null, fulfilled_by_name: null, created_at: new Date().toISOString(),
      audiences: { friends: input.audiences.friends ?? false, groups, hidden_count: 0 },
      source: { type: 'me', name: user.display_name }, group_id: groups[0]?.id ?? null, group_name: groups[0]?.name ?? null };
    this.social().requests.push(request);
    return { request: copy(request) };
  }

  async deleteRequest(id: string) {
    const request = this.visibleRequest(id);
    if (request.author_id !== this.requireUser().id) fail(403, 'forbidden', 'Only the author can cancel a request.');
    if (request.status !== 'open') fail(409, 'request_closed', 'Request is closed.');
    request.status = 'cancelled';
    return { request: this.requestView(request) };
  }

  async fulfilRequest(id: string) {
    const user = this.requireUser();
    const request = this.visibleRequest(id);
    if (request.author_id === user.id) fail(403, 'forbidden', 'You cannot fulfil your own request.');
    if (request.status !== 'open') fail(409, 'request_closed', 'Request is closed.');
    request.status = 'fulfilled';
    request.fulfilled_by = user.id;
    request.fulfilled_by_name = user.display_name;
    return { request: this.requestView(request) };
  }

  async getReachablePeople(itemId?: string): Promise<{ people: ReachablePerson[] }> {
    const user = this.requireUser();
    const state = this.social();
    const people = new Map<string, ReachablePerson>();
    for (const friend of state.friends.friends) people.set(friend.user_id, { id: friend.user_id, display_name: friend.display_name, kind: 'friend', groups: [], is_claimer: false });
    for (const group of state.groups.filter((entry) => state.memberships.has(entry.id))) for (const member of group.members.filter((entry) => entry.user_id !== user.id)) {
      const person = people.get(member.user_id) ?? { id: member.user_id, display_name: member.display_name, kind: 'group_member', groups: [], is_claimer: false };
      person.groups.push({ id: group.id, name: group.name });
      people.set(person.id, person);
    }
    if (itemId !== undefined) {
      const item = this.socialItem(itemId);
      const listing = this.allListings().find((entry) => entry.item_id === itemId && entry.status === 'open');
      if (item.owner_id !== user.id && !(item.group_id && state.memberships.has(item.group_id)) && !(listing && this.listingVisible(listing))) fail(404, 'not_found', 'Item not found.');
      if (item.group_id && !state.memberships.has(item.group_id)) fail(404, 'not_found', 'Item not found.');
      if (item.owner_id === user.id && listing?.claimed_by && people.has(listing.claimed_by)) people.get(listing.claimed_by)!.is_claimer = true;
    }
    return { people: [...people.values()].map((person) => ({ ...person, groups: person.groups.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => Number(b.is_claimer) - Number(a.is_claimer) || a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id)) };
  }


  private allListings(): ShareListing[] {
    const own = this.social().listings;
    return [...own, ...[...this.socialByUser.values()].flatMap((state) => state.listings)
      .filter((listing) => !own.includes(listing) && !listing.id.startsWith('listing-seed-'))];
  }
  private allRequests(): FoodRequest[] {
    const own = this.social().requests;
    return [...own, ...[...this.socialByUser.values()].flatMap((state) => state.requests)
      .filter((request) => !own.includes(request) && !['request-ana', 'request-mine'].includes(request.id))];
  }
  private allGroups(): GroupDetail[] {
    const own = this.social().groups;
    return [...new Set([...own, ...[...this.socialByUser.values()].flatMap((state) => state.groups)
      .filter((group) => group.id !== 'group-flat')])];
  }
  private groupView(group: GroupDetail): Group {
    return { ...groupSummary(group), role: group.members.find((member) => member.user_id === this.requireUser().id)?.role ?? 'member',
      member_count: group.members.length };
  }
  private mirrorFriend(targetId: string, status: 'pending' | 'accepted' | null) {
    const target = [...this.users.values()].find((user) => user.id === targetId);
    if (!target) return;
    let state = this.socialByUser.get(targetId);
    if (!state) {
      state = seedSocial(target);
      this.socialByUser.set(targetId, state);
    }
    const user = this.requireUser();
    for (const key of ['friends', 'incoming', 'outgoing'] as const) state.friends[key] = state.friends[key].filter((friend) => friend.user_id !== user.id);
    if (status) state.friends[status === 'accepted' ? 'friends' : 'incoming'].push({
      user_id: user.id, display_name: user.display_name, status, created_at: new Date().toISOString(),
    });
  }

  private social(): SocialState {
    const user = this.requireUser();
    let state = this.socialByUser.get(user.id);
    if (!state) {
      state = seedSocial(user);
      this.socialByUser.set(user.id, state);
    }
    return state;
  }
  private personName(id: string) {
    return DEMO_PEOPLE.find((person) => person.id === id)?.display_name
      ?? [...this.users.values()].find((person) => person.id === id)?.display_name ?? 'Group member';
  }
  private socialItem(id: string): Item {
    const item = [...this.items, ...this.social().pantry].find((entry) => entry.id === id);
    if (!item) fail(404, 'not_found', 'Item not found.');
    return item;
  }
  private memberGroup(id: string) {
    const group = this.allGroups().find((entry) => entry.id === id);
    if (!group) fail(404, 'not_found', 'Group not found.');
    if (!this.social().memberships.has(id)) fail(403, 'forbidden', 'You are not a member of this group.');
    return group;
  }
  private listingVisible(listing: ShareListing) {
    return listing.owner_id === this.requireUser().id || (listing.group_id ? this.social().memberships.has(listing.group_id)
      : this.social().friends.friends.some((friend) => friend.user_id === listing.owner_id));
  }
  private visibleListing(id: string) {
    const listing = this.allListings().find((entry) => entry.id === id);
    if (!listing || !this.listingVisible(listing)) fail(404, 'not_found', 'Listing not found.');
    return listing;
  }
  private ownedOpenListing(id: string) {
    const listing = this.visibleListing(id);
    if (listing.owner_id !== this.requireUser().id) fail(403, 'forbidden', 'Only the owner can edit a listing.');
    if (listing.status !== 'open') fail(409, 'listing_closed', 'Listing is closed.');
    return listing;
  }
  private syncItemShare(listing: ShareListing) {
    const item = this.findItem(listing.item_id);
    item.share = listing.status === 'cancelled' ? null : {
      id: listing.id, status: listing.status, claimed_by: listing.claimed_by ? { id: listing.claimed_by, name: this.personName(listing.claimed_by) } : null,
      audience: { friends: !listing.group_id, groups: listing.group_id ? [{ id: listing.group_id, name: this.social().groups.find((group) => group.id === listing.group_id)!.name }] : [] },
      pickup: copy(listing.pickup), pickup_set: listing.pickup_set };
  }
  private requestVisible(request: FoodRequest) {
    return request.author_id === this.requireUser().id ||
      (request.audiences.friends && this.social().friends.friends.some((friend) => friend.user_id === request.author_id)) ||
      request.audiences.groups.some((group) => this.social().memberships.has(group.id));
  }
  private visibleRequest(id: string) {
    const request = this.allRequests().find((entry) => entry.id === id);
    if (!request || !this.requestVisible(request)) fail(404, 'not_found', 'Request not found.');
    return request;
  }
  private requestView(request: FoodRequest): FoodRequest {
    const result = copy(request);
    result.audiences.groups = result.audiences.groups.filter((group) => this.social().memberships.has(group.id));
    result.audiences.friends = request.audiences.friends && (request.author_id === this.requireUser().id || this.social().friends.friends.some((friend) => friend.user_id === request.author_id));
    result.audiences.hidden_count = request.audiences.groups.length - result.audiences.groups.length + Number(request.audiences.friends && !result.audiences.friends);
    result.group_id = result.audiences.groups[0]?.id ?? null;
    result.group_name = result.audiences.groups[0]?.name ?? null;
    result.source = request.author_id === this.requireUser().id ? { type: 'me', name: request.author_name }
      : result.group_name ? { type: 'group', name: result.group_name } : { type: 'friend', name: request.author_name };
    return result;
  }

  private requireUser(): MockUser {
    if (!this.currentUser || !this.token) throw new ApiError(401, 'unauthorized', 'Sign in again.');
    return this.currentUser;
  }

  private findItem(id: string): Item {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new ApiError(404, 'not_found', 'Item not found.');
    return item;
  }

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}


function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}

function newestFirst(a: { created_at: string; id: string }, b: { created_at: string; id: string }) {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

function makeInviteCode(value: number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = alphabet[value % alphabet.length] + code;
    value = Math.floor(value / alphabet.length);
  } while (value > 0);
  return code.padStart(8, alphabet[0]);
}

function groupSummary(group: GroupDetail): Group {
  const { members: _members, ...summary } = group;
  return copy(summary);
}

function normalizePickup(input: Partial<PickupSpot> | null): PickupSpot | null {
  if (input === null) return null;
  if (!input || typeof input !== 'object') fail(400, 'validation_error', 'Invalid pickup spot.');
  const text = (value: string | null | undefined) => {
    if (value !== undefined && value !== null && typeof value !== 'string') fail(400, 'validation_error', 'Invalid pickup text.');
    const trimmed = value?.trim() || null;
    if (trimmed && (trimmed.length > 120 || trimmed.includes('\0'))) fail(400, 'validation_error', 'Pickup text must be at most 120 characters.');
    return trimmed;
  };
  const note = text(input.note);
  const place_name = text(input.place_name);
  const lat = input.lat ?? null;
  const lng = input.lng ?? null;
  if ((lat === null) !== (lng === null) ||
    (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) ||
    (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180)) ||
    (!note && lat === null)) fail(400, 'validation_error', 'Add a note or a valid latitude and longitude pair.');
  return { note, lat, lng, place_name };
}

function seedSocial(user: User): SocialState {
  const now = new Date(Date.now() - 86_400_000).toISOString();
  const group: GroupDetail = {
    id: 'group-flat', name: 'Flat 4B', role: 'member', member_count: 3, invite_code: 'F4AT8BCD',
    created_by: DEMO_PEOPLE[0].id, created_at: now,
    members: [
      { user_id: DEMO_PEOPLE[0].id, display_name: DEMO_PEOPLE[0].display_name, role: 'owner', joined_at: now },
      { user_id: 'group-maya', display_name: 'Maya Patel', role: 'member', joined_at: now },
      { user_id: user.id, display_name: user.display_name, role: 'member', joined_at: now },
    ],
  };
  const makeItem = (id: string, name: string, owner: string, groupId: string | null): Item => ({
    id, name, owner_id: owner, group_id: groupId, category: 'produce_hardy', food_group: 'veggies',
    storage: 'fridge', quantity: 2, unit: 'piece', est_weight_kg: 0.4, est_price: 2,
    source: 'manual', added_at: now, predicted_expiry: dateFromNow(3), expiry_source: 'default',
    removed_at: null, outcome: null, waste_reason: null, removed_after_expiry: null,
    freshness: 'fresh', freshness_checked_at: now, confidence: null, nutrition: null, share: null,
  });
  const pantry = [
    makeItem('group-carrots', 'Carrots', DEMO_PEOPLE[0].id, group.id),
    makeItem('share-apples', 'Apples', DEMO_PEOPLE[0].id, null),
    makeItem('share-peppers', 'Bell peppers', DEMO_PEOPLE[1].id, null),
  ];
  const pickup = { note: 'On the porch shelf', lat: 29.7604, lng: -95.3698, place_name: 'Community kitchen' };
  const listings: ShareListing[] = pantry.slice(1).map((item, index) => ({
    id: `listing-seed-${index}`, item_id: item.id, owner_id: item.owner_id,
    group_id: index ? null : group.id, status: 'open', recipient_id: null,
    claimed_by: index ? user.id : null, created_at: now, fulfilled_at: null,
    pickup: copy(pickup), pickup_set: true,
  }));
  const requests: FoodRequest[] = [
    { id: 'request-ana', author_id: DEMO_PEOPLE[0].id, author_name: DEMO_PEOPLE[0].display_name,
      text: 'Does anyone have an onion for dinner?', status: 'open', fulfilled_by: null, fulfilled_by_name: null,
      created_at: now, audiences: { friends: true, groups: [{ id: group.id, name: group.name }], hidden_count: 0 },
      source: { type: 'group', name: group.name }, group_id: group.id, group_name: group.name },
    { id: 'request-mine', author_id: user.id, author_name: user.display_name,
      text: 'Looking for a little flour for pancakes.', status: 'open', fulfilled_by: null, fulfilled_by_name: null,
      created_at: now, audiences: { friends: true, groups: [], hidden_count: 0 },
      source: { type: 'me', name: user.display_name }, group_id: null, group_name: null },
  ];
  return { friends: {
    friends: DEMO_PEOPLE.slice(0, 2).map((person) => ({ user_id: person.id, display_name: person.display_name, status: 'accepted', created_at: now })),
    incoming: [{ user_id: DEMO_PEOPLE[2].id, display_name: DEMO_PEOPLE[2].display_name, status: 'pending', created_at: now }],
    outgoing: [],
  }, groups: [group], memberships: new Set([group.id]), pantry, listings, requests, code: null };
}

function publicUser(user: MockUser): User {
  return { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at };
}

function validateRemoval(input: RemoveItemInput): void {
  if (input.outcome === 'thrown_out' && !input.waste_reason) {
    throw new ApiError(400, 'validation_error', 'Choose a waste reason.');
  }
  if (input.outcome !== 'thrown_out' && input.waste_reason !== undefined) {
    throw new ApiError(400, 'validation_error', 'A waste reason is only valid for thrown-out food.');
  }
  if (input.outcome !== 'donated' && 'recipient_id' in input) {
    throw new ApiError(400, 'validation_error', 'A recipient is only valid for donated food.');
  }
}

function eventFor(item: Item, at: string): MockEvent {
  if (!item.outcome) throw new Error('Cannot record an event without an outcome.');
  const kg = item.est_weight_kg ?? 0;
  return {
    itemId: item.id,
    outcome: item.outcome,
    reason: item.waste_reason,
    kg,
    money: item.est_price ?? 0,
    co2eKg: kg * 2.5,
    at,
  };
}

function zeroTotals(): ImpactTotals {
  return { count: 0, kg: 0, money: 0, co2e_kg: 0 };
}

function totals(events: MockEvent[]): ImpactTotals {
  return {
    count: events.length,
    kg: round(events.reduce((sum, event) => sum + event.kg, 0)),
    money: round(events.reduce((sum, event) => sum + event.money, 0)),
    co2e_kg: round(events.reduce((sum, event) => sum + event.co2eKg, 0)),
  };
}

function addTotals(a: ImpactTotals, b: ImpactTotals): ImpactTotals {
  return {
    count: a.count + b.count,
    kg: round(a.kg + b.kg),
    money: round(a.money + b.money),
    co2e_kg: round(a.co2e_kg + b.co2e_kg),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// Same category -> (fridge, pantry, freezer) days as backend/app/services/expiry.py.
const SHELF_LIFE_DAYS: Record<ItemCategory, [number, number, number]> = {
  produce_leafy: [5, 2, 240],
  produce_hardy: [21, 7, 300],
  dairy: [10, 1, 90],
  meat: [3, 1, 180],
  seafood: [2, 1, 120],
  bakery: [10, 4, 90],
  eggs: [28, 7, 120],
  leftovers: [4, 1, 90],
  pantry_dry: [180, 365, 365],
  frozen: [2, 1, 270],
  other: [7, 30, 90],
};
const THAW_CAP_DAYS: Partial<Record<ItemCategory, number>> = { meat: 2, seafood: 2, leftovers: 3 };

function reestimateExpiry(category: ItemCategory, oldStorage: Storage, newStorage: Storage, oldExpiry: string | null): string {
  const today = dateFromNow(0);
  const addDays = (days: number) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  const row = SHELF_LIFE_DAYS[category] ?? SHELF_LIFE_DAYS.other;
  const indices = { fridge: 0, pantry: 1, freezer: 2 };
  const newDays = row[indices[newStorage]];
  if (oldExpiry === null) return addDays(newDays);
  if (newStorage === 'freezer') return oldExpiry < today ? oldExpiry : addDays(newDays);
  if (oldStorage === 'freezer') return addDays(Math.min(newDays, THAW_CAP_DAYS[category] ?? newDays));
  const left = (Date.parse(oldExpiry) - Date.parse(today)) / 86_400_000;
  if (left <= 0) return oldExpiry;
  const days = Math.min(left / row[indices[oldStorage]], 1) * newDays;
  // Python round() rounds exact halves to the nearest even integer.
  const floor = Math.floor(days);
  const rounded = days - floor === 0.5 ? floor + floor % 2 : Math.round(days);
  return addDays(Math.max(1, rounded));
}

function compareItems(a: Item, b: Item): number {
  if (a.predicted_expiry === null) return b.predicted_expiry === null ? a.added_at.localeCompare(b.added_at) : 1;
  if (b.predicted_expiry === null) return -1;
  return a.predicted_expiry.localeCompare(b.predicted_expiry) || a.added_at.localeCompare(b.added_at);
}

function weekStart(date: Date): string {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function weeklyCounts(events: MockEvent[]): ImpactResponse['weekly'] {
  const weeks = new Map<string, { week: string; saved: number; wasted: number }>();
  for (const event of events) {
    const week = weekStart(new Date(event.at));
    const entry = weeks.get(week) ?? { week, saved: 0, wasted: 0 };
    if (event.outcome === 'thrown_out') entry.wasted += 1;
    else entry.saved += 1;
    weeks.set(week, entry);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function lastSixWeeks(events: MockEvent[]): ImpactResponse['last_6_weeks'] {
  const current = weekStart(new Date());
  const start = Date.parse(`${current}T00:00:00.000Z`) - 5 * 7 * 86_400_000;
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(start + index * 7 * 86_400_000);
    const week = date.toISOString().slice(0, 10);
    const inWeek = events.filter((event) => weekStart(new Date(event.at)) === week);
    const used = inWeek.filter((event) => event.outcome === 'used').length;
    const donated = inWeek.filter((event) => event.outcome === 'donated').length;
    return {
      week,
      used,
      donated,
      saved: used + donated,
      wasted: inWeek.filter((event) => event.outcome === 'thrown_out').length,
    };
  });
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
