import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { isApiError, useApi, type Item } from '@/api';

export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export interface UndoEntry {
  item: Item;
  expiresAt: number;
  restoring: boolean;
  error: string | null;
}

export function useRemovalUndo(onRestored: (item: Item) => void) {
  const { api } = useApi();
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const restoringIds = useRef(new Set<string>());

  useEffect(() => {
    if (entries.length === 0) return;
    const prune = () => setEntries((current) => current.filter((entry) => entry.expiresAt > Date.now()));
    const nextExpiry = Math.min(...entries.map((entry) => entry.expiresAt));
    const timer = setTimeout(prune, Math.max(0, nextExpiry - Date.now()));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') prune();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [entries]);

  function remember(item: Item) {
    // Use the server removal time: network latency must not extend the window.
    const removedAt = item.removed_at ? Date.parse(item.removed_at) : Date.now();
    const expiresAt = removedAt + UNDO_WINDOW_MS;
    if (expiresAt <= Date.now()) return;
    setEntries((current) => [
      ...current.filter((entry) => entry.item.id !== item.id),
      { item, expiresAt, restoring: false, error: null },
    ]);
  }

  async function undo(entry: UndoEntry) {
    const id = entry.item.id;
    if (restoringIds.current.has(id)) return;
    if (entry.expiresAt <= Date.now()) {
      setEntries((current) => current.filter((candidate) => candidate.item.id !== id));
      return;
    }
    restoringIds.current.add(id);
    setEntries((current) => current.map((candidate) => candidate.item.id === id ? { ...candidate, restoring: true, error: null } : candidate));
    try {
      const { item } = await api.restoreItem(id);
      setEntries((current) => current.filter((candidate) => candidate.item.id !== id));
      onRestored(item);
    } catch (cause) {
      if (isApiError(cause) && cause.code === 'restore_window_expired') {
        setEntries((current) => current.filter((candidate) => candidate.item.id !== id));
      } else {
        const error = cause instanceof Error ? cause.message : 'Couldn’t undo removal. Try again.';
        setEntries((current) => current.map((candidate) => candidate.item.id === id ? { ...candidate, restoring: false, error } : candidate));
      }
    } finally {
      restoringIds.current.delete(id);
    }
  }

  return { entries, remember, undo };
}
