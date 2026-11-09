import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { normalizeBaseUrl } from './config';
import { ApiError } from './errors';
import type {
  ApiClient,
  AuthMeResponse,
  AuthResponse,
  CreateItemInput,
  ImpactRange,
  ImpactResponse,
  ItemsQuery,
  ItemsResponse,
  ItemSectionsResponse,
  PhotoCandidatesResponse,
  ReceiptCandidatesResponse,
  Recipe,
  RecipesRequest,
  RemoveBatchInput,
  RemoveItemInput,
} from './types';

interface LiveApiClientOptions {
  getBaseUrl: () => string;
  getToken: () => Promise<string | null>;
  setToken: (token: string | null) => Promise<void>;
  onSessionExpired: () => void;
  fetcher?: typeof fetch;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: string | FormData;
  authenticated?: boolean;
  timeoutMs?: number;
}

export class LiveApiClient implements ApiClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: LiveApiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  health() {
    return this.request<{ status: 'ok' }>('/health', { authenticated: false, timeoutMs: 10_000 });
  }

  async signup(input: { email: string; password: string; display_name: string }): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
      authenticated: false,
    });
    await this.options.setToken(response.token);
    return response;
  }

  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
      authenticated: false,
    });
    await this.options.setToken(response.token);
    return response;
  }

  me() {
    return this.request<AuthMeResponse>('/auth/me');
  }

  async deleteMe(): Promise<void> {
    await this.request<void>('/auth/me', { method: 'DELETE' });
    await this.options.setToken(null);
  }

  getItems(query: ItemsQuery = {}): Promise<ItemsResponse | ItemSectionsResponse> {
    const params = new URLSearchParams();
    if (query.storage) params.set('storage', query.storage);
    if (query.include_removed !== undefined) params.set('include_removed', String(query.include_removed));
    if (query.group_by) params.set('group_by', query.group_by);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request<ItemsResponse | ItemSectionsResponse>(`/items${suffix}`);
  }

  createItems(input: { items: CreateItemInput[]; group_id?: string }) {
    return this.request<ItemsResponse>('/items', { method: 'POST', body: JSON.stringify(input) });
  }

  async fromPhoto(input: {
    uri: string;
    fileName?: string;
    mimeType?: string;
    mode: 'fridge' | 'single';
    enrich?: ('expiry' | 'nutrition')[];
  }): Promise<PhotoCandidatesResponse> {
    const form = new FormData();
    await this.appendImage(form, input, 'photo.jpg');
    form.append('mode', input.mode);
    if (input.enrich?.length) form.append('enrich', input.enrich.join(','));
    return this.request<PhotoCandidatesResponse>('/items/from-photo', {
      method: 'POST',
      body: form,
      timeoutMs: 75_000,
    });
  }

  removeItem(id: string, input: RemoveItemInput) {
    return this.request<{ item: import('./types').Item }>(`/items/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  restoreItem(id: string) {
    return this.request<{ item: import('./types').Item }>(`/items/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
    });
  }

  removeBatch(input: RemoveBatchInput) {
    return this.request<ItemsResponse>('/items/remove-batch', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  restoreBatch(itemIds: string[]) {
    return this.request<ItemsResponse>('/items/restore-batch', {
      method: 'POST',
      body: JSON.stringify({ item_ids: itemIds }),
    });
  }

  parseText(input: { text: string }) {
    return this.request<{ candidates: import('./types').ItemCandidate[] }>('/items/parse-text', {
      method: 'POST',
      body: JSON.stringify(input),
      timeoutMs: 75_000,
    });
  }

  async fromReceipt(input: { uri: string; fileName?: string; mimeType?: string }): Promise<ReceiptCandidatesResponse> {
    const form = new FormData();
    await this.appendImage(form, input, 'receipt.jpg');
    return this.request<ReceiptCandidatesResponse>('/items/from-receipt', {
      method: 'POST',
      body: form,
      timeoutMs: 120_000,
    });
  }

  suggestRecipes(input: RecipesRequest = {}) {
    return this.request<{ recipes: Recipe[] }>('/recipes/suggest', {
      method: 'POST',
      body: JSON.stringify(input),
      timeoutMs: 75_000,
    });
  }

  getImpact(range: ImpactRange = 'all') {
    return this.request<ImpactResponse>(`/impact?range=${range}`);
  }

  // Expo's fetch (SDK 52+) rejects React Native's { uri, name, type } parts, so native
  // uploads send the file's bytes. The part's name and type set the multipart headers.
  private async appendImage(
    form: FormData,
    input: { uri: string; fileName?: string; mimeType?: string },
    fallbackName: string,
  ): Promise<void> {
    const name = input.fileName ?? fallbackName;
    if (Platform.OS === 'web') {
      const blob = await (await this.fetcher(input.uri)).blob();
      form.append('image', blob, name);
      return;
    }
    const file = new File(input.uri);
    form.append('image', {
      name,
      type: input.mimeType ?? 'image/jpeg',
      bytes: () => file.bytes(),
    } as unknown as Blob);
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    const headers = new Headers({ Accept: 'application/json' });
    if (options.authenticated !== false) {
      const token = await this.options.getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');

    try {
      const response = await this.fetcher(`${normalizeBaseUrl(this.options.getBaseUrl())}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      const payload: unknown = text ? parseJson(text) : undefined;
      if (!response.ok) {
        const { code, message } = errorDetails(response.status, payload);
        if (response.status === 401 && code === 'unauthorized') {
          await this.options.setToken(null);
          this.options.onSessionExpired();
        }
        throw new ApiError(response.status, code, message);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (__DEV__) console.warn(`[api] ${options.method ?? 'GET'} ${path} failed:`, error);
      throw new ApiError(
        0,
        'upstream_unavailable',
        error instanceof Error && error.name === 'AbortError'
          ? 'The request timed out. Try again.'
          : 'Can’t reach BiteDown. Check your connection and server address, then try again.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorDetails(status: number, payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const code = (error as { code?: unknown }).code;
      const message = (error as { message?: unknown }).message;
      if (typeof code === 'string' && typeof message === 'string') return { code, message };
    }
  }
  return {
    code: status >= 500 ? 'internal_error' : 'http_error',
    message: 'BiteDown couldn’t complete that request. Try again.',
  };
}
