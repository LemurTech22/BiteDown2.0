export const DEFAULT_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:5055';
export const DEFAULT_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
export const API_CONFIG_URL = process.env.EXPO_PUBLIC_API_CONFIG_URL ?? '';

export function normalizeRemoteBaseUrl(value: unknown): string | null {
  try {
    if (typeof value !== 'string') return null;
    const normalized = normalizeBaseUrl(value);
    const url = new URL(normalized);
    if (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function fetchRemoteApiBaseUrl(fetcher = fetch, timeoutMs = 5000): Promise<string | null> {
  if (!API_CONFIG_URL) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetcher(API_CONFIG_URL, { method: 'GET', cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const config: unknown = await response.json();
    if (!config || typeof config !== 'object' || !('api_base_url' in config)) return null;
    return normalizeRemoteBaseUrl(config.api_base_url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server address must start with http:// or https://.');
  }
  return trimmed;
}
