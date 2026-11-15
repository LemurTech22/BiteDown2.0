import { useCallback, useSyncExternalStore } from 'react';

import { ApiError } from '@/api/errors';

let serverError: unknown = null;
let revision = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Report transport failures and HTTP 5xx only; validation and auth errors stay local. */
export function reportServerError(error: unknown): boolean {
  const transportFailure = error instanceof Error && (
    error.name === 'AbortError' ||
    (error instanceof TypeError && /network|failed to fetch|fetch failed|load failed/i.test(error.message))
  );
  if (!(error instanceof ApiError ? error.status === 0 || (error.status >= 500 && error.status < 600) : transportFailure)) {
    return false;
  }
  serverError = error;
  revision += 1;
  emit();
  return true;
}

export function clearServerError() {
  serverError = null;
  revision += 1;
  emit();
}

export function getServerErrorRevision() {
  return revision;
}

export function useServerError() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => serverError !== null,
    () => false,
  );
}

/** Call the returned reporter from a screen's API catch blocks. */
export function useServerErrorReporter() {
  return useCallback((error: unknown) => reportServerError(error), []);
}
