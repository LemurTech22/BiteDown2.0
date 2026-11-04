import { ApiError } from './errors';
import type {
  ApiClient,
  AuthMeResponse,
  AuthResponse,
  CreateItemInput,
  FoodGroup,
  ImpactRange,
  ImpactResponse,
  ImpactTotals,
  Item,
  ItemCandidate,
  ItemsQuery,
  ItemsResponse,
  ItemSectionsResponse,
  Outcome,
  PhotoCandidatesResponse,
  ReceiptCandidatesResponse,
  Recipe,
  RecipesRequest,
  RemoveBatchInput,
  RemoveItemInput,
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
    return { item: copy(item) };
  }

  async restoreItem(id: string): Promise<{ item: Item }> {
    this.requireUser();
    const item = this.findItem(id);
    if (!item.removed_at || !item.outcome) throw new ApiError(409, 'not_removed', 'That item is still active.');
    if (Date.now() - Date.parse(item.removed_at) >= 10 * 60 * 1000) {
      throw new ApiError(409, 'restore_window_expired', 'The 10-minute undo window has expired.');
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
      throw error;
    }
  }

  async restoreBatch(itemIds: string[]): Promise<ItemsResponse> {
    this.requireUser();
    const snapshot = copy(this.items);
    const eventSnapshot = copy(this.events);
    try {
      const items: Item[] = [];
      for (const id of itemIds) items.push((await this.restoreItem(id)).item);
      return { items };
    } catch (error) {
      this.items = snapshot;
      this.events = eventSnapshot;
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
      candidates: parsed.candidates.map((candidate) => ({ ...candidate, source: 'receipt', price: 2.5, est_price: 2.5 })),
      total: 2.5,
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
