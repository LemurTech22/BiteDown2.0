import { useRef, useState } from 'react';

import { isApiError, useApi, type Item } from '@/api';
import { RESTORE_WINDOW_MS } from '@/api/removal-window';
import { UNDO_TOAST_MS } from '@/features/remove/use-undo-toast-timeout';

export { RESTORE_WINDOW_MS } from '@/api/removal-window';
export { UNDO_TOAST_MS } from '@/features/remove/use-undo-toast-timeout';

export interface UndoEntry {
  item: Item;
  expiresAt: number;
  toastExpiresAt: number;
  restoring: boolean;
  error: string | null;
}

export function useRemovalUndo(onRestored: (item: Item) => void) {
  const { api } = useApi();
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const restoringIds = useRef(new Set<string>());

  function remember(item: Item) {
    // Use the server removal time: network latency must not extend the window.
    const removedAt = item.removed_at ? Date.parse(item.removed_at) : Date.now();
    const expiresAt = removedAt + RESTORE_WINDOW_MS;
    if (expiresAt <= Date.now()) return;
    setEntries([{ item, expiresAt, toastExpiresAt: Date.now() + UNDO_TOAST_MS, restoring: false, error: null }]);
  }

  async function undo(entry: UndoEntry) {
    const id = entry.item.id;
    if (restoringIds.current.has(id)) return;
    if (entry.expiresAt <= Date.now()) {
      setEntries((current) => current.map((candidate) => candidate.item.id === id
        ? { ...candidate, error: 'Items can only be restored within 7 days of removal.' } : candidate));
      return;
    }
    restoringIds.current.add(id);
    setEntries((current) => current.map((candidate) => candidate.item.id === id ? { ...candidate, restoring: true, error: null } : candidate));
    try {
      const { item } = await api.restoreItem(id);
      setEntries((current) => current.filter((candidate) => candidate.item.id !== id));
      onRestored(item);
    } catch (cause) {
      const error = isApiError(cause) && cause.code === 'restore_window_expired'
        ? 'Items can only be restored within 7 days of removal.'
        : cause instanceof Error ? cause.message : 'Couldn’t undo removal. Try again.';
      setEntries((current) => current.map((candidate) => candidate.item.id === id ? { ...candidate, restoring: false, error } : candidate));
    } finally {
      restoringIds.current.delete(id);
    }
  }

  function dismiss(id?: string) {
    setEntries((current) => id === undefined ? [] : current.filter((entry) => entry.item.id !== id));
  }

  return { entries, remember, undo, dismiss };
}
