import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { type Item } from '@/api';
import { BatchUndoToast, type BatchUndo } from '@/features/fridge/batch-undo-toast';
import { UndoToast } from '@/features/remove/undo-toast';
import { RESTORE_WINDOW_MS, UNDO_TOAST_MS, type UndoEntry } from '@/features/remove/use-removal-undo';

describe.each(['single', 'batch'] as const)('%s Undo panel', (kind) => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  function panel(onDismiss: () => void, pending = false, error = '') {
    const common = { expiresAt: Date.now() + RESTORE_WINDOW_MS, toastExpiresAt: Date.now() + UNDO_TOAST_MS, error };
    const single: UndoEntry = { ...common, item: { id: 'apple', name: 'Apple' } as Item, restoring: pending };
    const batch: BatchUndo = { ...common, id: 1, itemIds: ['apple'], outcome: 'used', pending };
    return kind === 'single' ? <UndoToast entry={single} onUndo={jest.fn()} onDismiss={onDismiss} />
      : <BatchUndoToast entry={batch} onUndo={jest.fn()} onDismiss={onDismiss} />;
  }

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
