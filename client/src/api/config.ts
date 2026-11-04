export const DEFAULT_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:5055';
export const DEFAULT_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server address must start with http:// or https://.');
  }
  return trimmed;
}
