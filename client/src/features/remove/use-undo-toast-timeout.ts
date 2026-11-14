import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

export const UNDO_TOAST_MS = 8000;

export function useUndoToastTimeout(deadline: number, blocked: boolean, onDismiss: () => void) {
  // Keep the panel until the accessibility query has completed. react-native-web cannot detect a screen reader and
  // always answers true, which would keep every panel forever; on web the Dismiss button and Recently removed are the
  // untimed paths, so the timer runs.
  const [screenReader, setScreenReader] = useState(Platform.OS !== 'web');
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      changed = true;
      setScreenReader(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active && !changed) setScreenReader(enabled);
    }).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (blocked || screenReader) return;
    const expire = () => { if (Date.now() >= deadline) dismiss.current(); };
    const timer = setTimeout(expire, Math.max(0, deadline - Date.now()));
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') expire(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [blocked, deadline, screenReader]);
}
