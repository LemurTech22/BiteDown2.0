import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

export const UNDO_TOAST_MS = 8000;
export const UNDO_RESUME_MIN_MS = 2000;

type PauseReason = 'hover' | 'focus' | 'press';

export function useUndoToastTimeout(deadline: number, blocked: boolean, onDismiss: () => void) {
  // Keep the panel until the accessibility query has completed. react-native-web cannot detect a screen reader and
  // always answers true, which would keep every panel forever; on web the Dismiss button and Recently removed are the
  // untimed paths, so the timer runs.
  const [screenReader, setScreenReader] = useState(Platform.OS !== 'web');
  const clock = useRef({ deadline, remaining: 0 });
  const reasons = useRef(new Set<PauseReason>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [interaction, setInteraction] = useState(0);
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    clock.current = { deadline, remaining: Math.max(0, deadline - Date.now()) };
  }, [deadline]);

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
    if (blocked || screenReader || reasons.current.size > 0) return;
    const expire = () => {
      if (reasons.current.size === 0 && Date.now() >= clock.current.deadline) dismiss.current();
    };
    timer.current = setTimeout(expire, Math.max(0, clock.current.deadline - Date.now()));
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') expire(); });
    return () => { clearTimeout(timer.current); subscription.remove(); };
  }, [blocked, deadline, screenReader, interaction]);

  function pause(reason: PauseReason) {
    if (reasons.current.has(reason)) return;
    if (reasons.current.size === 0) {
      clock.current.remaining = Math.max(0, clock.current.deadline - Date.now());
      clearTimeout(timer.current);
    }
    reasons.current.add(reason);
    setInteraction((current) => current + 1);
  }

  function resume(reason: PauseReason) {
    if (!reasons.current.delete(reason) || reasons.current.size > 0) return;
    clock.current.deadline = Date.now() + Math.max(clock.current.remaining, UNDO_RESUME_MIN_MS);
    setInteraction((current) => current + 1);
  }

  return { pause, resume };
}
