import type { Href } from 'expo-router';

type SocialPath = Extract<Href, `/social/${string}`>;

export function socialNext(next: string | string[] | undefined): SocialPath | undefined {
  if (typeof next !== 'string' || !next.startsWith('/social/')) return undefined;
  try {
    const decoded = decodeURIComponent(next);
    if (/\/\/|\.\.|[a-z][a-z\d+.-]*:|\\|[\u0000-\u001f\u007f]/i.test(decoded)) return undefined;
  } catch {
    return undefined;
  }
  return next as SocialPath;
}
