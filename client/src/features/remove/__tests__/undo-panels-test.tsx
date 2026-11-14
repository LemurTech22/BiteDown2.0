import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus, Platform } from 'react-native';

import { type Item } from '@/api';
import { BatchUndoToast, type BatchUndo } from '@/features/fridge/batch-undo-toast';
import { UndoToast } from '@/features/remove/undo-toast';
import { RESTORE_WINDOW_MS, UNDO_TOAST_MS, type UndoEntry } from '@/features/remove/use-removal-undo';
import { UNDO_RESUME_MIN_MS } from '@/features/remove/use-undo-toast-timeout';

describe.each(['single', 'batch'] as const)('%s Undo panel', (kind) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  function panel(onDismiss: () => void, pending = false, error = '', deadline = Date.now() + UNDO_TOAST_MS) {
    const common = { expiresAt: Date.now() + RESTORE_WINDOW_MS, toastExpiresAt: deadline, error };
    const single: UndoEntry = { ...common, item: { id: 'apple', name: 'Apple' } as Item, restoring: pending };
    const batch: BatchUndo = { ...common, id: 1, itemIds: ['apple'], outcome: 'used', pending };
    return kind === 'single' ? <UndoToast entry={single} onUndo={jest.fn()} onDismiss={onDismiss} />
      : <BatchUndoToast entry={batch} onUndo={jest.fn()} onDismiss={onDismiss} />;
  }

  const panelId = kind === 'single' ? 'remove.toast.apple' : 'fridge.batchToast.1';
  const undoId = kind === 'single' ? 'remove.undo.apple' : 'fridge.batchUndo.1';
  const dismissId = kind === 'single' ? 'undo.dismiss.apple' : 'fridge.batchUndo.dismiss.1';

  test.each([1000, UNDO_TOAST_MS - 1])('hover preserves remaining time with a two-second minimum, paused at %s ms', async (elapsed) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(elapsed));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId(panelId), 'pointerLeave');
    const remaining = Math.max(UNDO_TOAST_MS - elapsed, UNDO_RESUME_MIN_MS);
    await act(() => jest.advanceTimersByTime(remaining - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each([
    [undoId, 'focus', 'blur'], [dismissId, 'focus', 'blur'],
    [undoId, 'pressIn', 'pressOut'], [dismissId, 'pressIn', 'pressOut'],
  ])('%s pauses on %s and resumes on %s', async (id, start, end) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS - 1));
    await fireEvent(screen.getByTestId(id), start);
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId(id), end);
    await act(() => jest.advanceTimersByTime(UNDO_RESUME_MIN_MS - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each(['hover', 'focus'] as const)('overlapping hover and focus wait for both to end, %s ends first', async (first) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS - 1));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    await fireEvent(screen.getByTestId(undoId), 'focus');
    const leave = () => fireEvent(screen.getByTestId(panelId), 'pointerLeave');
    const blur = () => fireEvent(screen.getByTestId(undoId), 'blur');
    await (first === 'hover' ? leave() : blur());
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await (first === 'hover' ? blur() : leave());
    await act(() => jest.advanceTimersByTime(UNDO_RESUME_MIN_MS - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('Dismiss closes immediately while hover, focus and press are active', async () => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    await fireEvent(screen.getByTestId(dismissId), 'focus');
    await fireEvent(screen.getByTestId(dismissId), 'pressIn');
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId(dismissId));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])('a changed deadline resets the effective deadline, paused=%s', async (paused) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    if (paused) await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    await act(() => jest.advanceTimersByTime(1000));
    await screen.rerender(panel(dismiss));
    if (paused) {
      await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
      expect(dismiss).not.toHaveBeenCalled();
      await fireEvent(screen.getByTestId(panelId), 'pointerLeave');
    }
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('an already-passed deadline still gets two seconds after interaction', async () => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss, true));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    await screen.rerender(panel(dismiss, false, '', Date.now() - 1));
    await fireEvent(screen.getByTestId(panelId), 'pointerLeave');
    await act(() => jest.advanceTimersByTime(UNDO_RESUME_MIN_MS - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('web ignores the screen-reader query', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const dismiss = jest.fn();
    await render(panel(dismiss));
    expect(AccessibilityInfo.isScreenReaderEnabled).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('AppState active checks the effective deadline and respects a pause', async () => {
    let change: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      change = listener;
      return { remove: jest.fn() };
    });
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter');
    jest.setSystemTime(Date.now() + UNDO_TOAST_MS * 2);
    await act(() => change?.('active'));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId(panelId), 'pointerLeave');
    await act(() => change?.('active'));
    expect(dismiss).not.toHaveBeenCalled();
    jest.setSystemTime(Date.now() + UNDO_TOAST_MS);
    await act(() => change?.('active'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('auto-dismisses at exactly eight seconds', async () => {
    const dismiss = jest.fn();
    await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS - 1));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('close has a 44 pt target and dismisses immediately', async () => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    const button = screen.getByTestId(kind === 'single' ? 'undo.dismiss.apple' : 'fridge.batchUndo.dismiss.1');
    expect(button).toHaveProp('accessibilityLabel', 'Dismiss');
    expect(button).toHaveStyle({ minWidth: 44, minHeight: 44 });
    await fireEvent.press(button);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each(['pending', 'error'])('does not auto-dismiss while %s', async (state) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss, state === 'pending', state === 'error' ? 'Offline' : ''));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('does not auto-dismiss with a screen reader enabled initially', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS * 2));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('honors screen-reader changes and cleans up its subscription', async () => {
    let change: ((enabled: boolean) => void) | undefined;
    const remove = jest.fn();
    const original = AccessibilityInfo.addEventListener;
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'screenReaderChanged') {
        change = listener as (enabled: boolean) => void;
        return { remove };
      }
      return original(event, listener);
    });
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS - 1));
    await act(() => change?.(true));
    await act(() => jest.advanceTimersByTime(UNDO_TOAST_MS));
    expect(dismiss).not.toHaveBeenCalled();
    await screen.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
