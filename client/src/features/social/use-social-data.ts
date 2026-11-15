import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { reportServerError } from '@/components/server-error';

export function useSocialData<T>(fetchData: () => Promise<T>) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: T | null; error: string }>({
    status: 'loading', data: null, error: '',
  });
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setState((current) => current.status === 'ready' ? current : { status: 'loading', data: null, error: '' });
    try {
      const data = await fetchData();
      if (request === sequence.current) setState({ status: 'ready', data, error: '' });
    } catch (cause) {
      reportServerError(cause);
      if (request === sequence.current) setState({ status: 'error', data: null, error: errorMessage(cause) });
    }
  }, [fetchData]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; sequence.current += 1; };
  }, [load]));
  const updateData = useCallback((update: (data: T) => T) => {
    // A completed mutation wins over a refresh that started before it.
    sequence.current += 1;
    setState((current) => current.data === null ? current : { ...current, data: update(current.data) });
  }, []);
  return { ...state, reload: load, updateData };
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Something went wrong. Try again.';
}
