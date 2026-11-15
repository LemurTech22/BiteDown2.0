// Photos already shown once this session. A re-signed URL, a remount or switching back to an earlier photo must not
// fade again (MOTION.md: never animate on every data refresh). Bounded so a long session can't grow it without limit.
export const loadedPhotos = new Set<string>();
const LOADED_PHOTOS_MAX = 500;

export function rememberLoaded(key: string): boolean {
  if (loadedPhotos.has(key)) return false;
  if (loadedPhotos.size >= LOADED_PHOTOS_MAX) loadedPhotos.delete(loadedPhotos.values().next().value as string);
  loadedPhotos.add(key);
  return true;
}

/** Test hook: forget which photos have loaded. */
export function resetLoadedPhotosForTests() {
  loadedPhotos.clear();
}
