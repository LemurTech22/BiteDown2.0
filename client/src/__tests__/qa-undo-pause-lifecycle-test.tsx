import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

import type { Item } from '@/api';
import { BatchUndoToast } from '@/features/fridge/batch-undo-toast';
import { UndoToast } from '@/features/remove/undo-toast';
import { useUndoToastTimeout } from '@/features/remove/use-undo-toast-timeout';

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-14T12:00:00Z'));
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each(['running', 'hover', 'focus', 'press', 'blocked'] as const)('unmount cleans timers and subscriptions while %s', async (state) => {
  const dismiss = jest.fn();
  const removeAccessibility = jest.fn();
  const removeAppState = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: removeAccessibility });
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: removeAppState });
  const timeout = jest.spyOn(globalThis, 'setTimeout');
  const clear = jest.spyOn(globalThis, 'clearTimeout');
  const deadline = Date.now() + 8000;
  const hook = await renderHook(() => useUndoToastTimeout(deadline, state === 'blocked', dismiss));
  const timerIndex = timeout.mock.calls.findIndex(([, delay]) => delay === 8000);
  expect(timerIndex >= 0).toBe(state !== 'blocked');
  if (state !== 'running' && state !== 'blocked') await act(() => hook.result.current.pause(state));
  await hook.unmount();
  if (timerIndex >= 0) expect(clear).toHaveBeenCalledWith(timeout.mock.results[timerIndex].value);
  expect(removeAccessibility).toHaveBeenCalledTimes(1);
  expect(removeAppState).toHaveBeenCalledTimes(state === 'blocked' ? 0 : 1);
  await act(() => jest.advanceTimersByTime(60000));
  expect(dismiss).not.toHaveBeenCalled();
});

test('late accessibility query resolution cannot start a timer after unmount', async () => {
  let resolve!: (enabled: boolean) => void;
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const dismiss = jest.fn();
  const timeout = jest.spyOn(globalThis, 'setTimeout');
  const deadline = Date.now() + 8000;
  const hook = await renderHook(() => useUndoToastTimeout(deadline, false, dismiss));
  await hook.unmount();
  await act(() => resolve(false));
  expect(timeout.mock.calls.some(([, delay]) => delay === 8000)).toBe(false);
  await act(() => jest.advanceTimersByTime(60000));
  expect(dismiss).not.toHaveBeenCalled();
});

test('rerenders use the latest dismissal callback without restarting the clock', async () => {
  const first = jest.fn();
  const latest = jest.fn();
  const deadline = Date.now() + 8000;
  const hook = await renderHook(({ dismiss }: { dismiss: () => void }) => useUndoToastTimeout(deadline, false, dismiss), { initialProps: { dismiss: first } });
  await act(() => jest.advanceTimersByTime(7000));
  await hook.rerender({ dismiss: latest });
  await act(() => jest.advanceTimersByTime(999));
  expect(latest).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(1));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

test('duplicate starts and unmatched ends cannot strand or prematurely resume a pause', async () => {
  const dismiss = jest.fn();
  const deadline = Date.now() + 8000;
  const hook = await renderHook(() => useUndoToastTimeout(deadline, false, dismiss));
  await act(() => jest.advanceTimersByTime(7000));
  await act(() => { hook.result.current.pause('hover'); hook.result.current.pause('hover'); hook.result.current.resume('press'); });
  await act(() => jest.advanceTimersByTime(60000));
  expect(dismiss).not.toHaveBeenCalled();
  await act(() => { hook.result.current.resume('hover'); hook.result.current.resume('hover'); });
  await act(() => jest.advanceTimersByTime(1999));
  expect(dismiss).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

describe.each(['single', 'batch'] as const)('QA %s panel interaction lifecycle', (kind) => {
  const panelId = kind === 'single' ? 'remove.toast.qa' : 'fridge.batchToast.12';
  const undoId = kind === 'single' ? 'remove.undo.qa' : 'fridge.batchUndo.12';
  const dismissId = kind === 'single' ? 'undo.dismiss.qa' : 'fridge.batchUndo.dismiss.12';

  function panel(onDismiss: () => void, onUndo = jest.fn()) {
    const common = { expiresAt: Date.now() + 7 * 86400000, toastExpiresAt: Date.now() + 8000, error: '' };
    return kind === 'single'
      ? <UndoToast entry={{ ...common, item: { id: 'qa', name: 'QA food' } as Item, restoring: false }} onDismiss={onDismiss} onUndo={onUndo} />
      : <BatchUndoToast entry={{ ...common, id: 12, itemIds: ['qa'], outcome: 'used', pending: false }} onDismiss={onDismiss} onUndo={onUndo} />;
  }

  test.each([
    ['hover', 'focus', 'press'], ['focus', 'press', 'hover'], ['press', 'hover', 'focus'],
  ] as const)('three overlapping reasons resume only after %s, %s, %s end', async (...order) => {
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(7999));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter', { nativeEvent: { pointerType: 'mouse' } });
    await fireEvent(screen.getByTestId(undoId), 'focus');
    await fireEvent(screen.getByTestId(undoId), 'pressIn');
    const end = {
      hover: () => fireEvent(screen.getByTestId(panelId), 'pointerLeave'),
      focus: () => fireEvent(screen.getByTestId(undoId), 'blur'),
      press: () => fireEvent(screen.getByTestId(undoId), 'pressOut'),
    };
    for (const reason of order.slice(0, 2)) {
      await end[reason]();
      await act(() => jest.advanceTimersByTime(16000));
      expect(dismiss).not.toHaveBeenCalled();
    }
    await end[order[2]]();
    await act(() => jest.advanceTimersByTime(1999));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each(['undo', 'dismiss'] as const)('a cancelled touch on %s releases press and touch-pointer pauses without activating it', async (target) => {
    const dismiss = jest.fn();
    const undo = jest.fn();
    const screen = await render(panel(dismiss, undo));
    const button = screen.getByTestId(target === 'undo' ? undoId : dismissId);
    const touch = { pageX: 1, pageY: 1, identifier: 1, timestamp: Date.now() };
    const event = { persist: jest.fn(), currentTarget: { measure: jest.fn() }, nativeEvent: { ...touch, touches: [touch], changedTouches: [touch] } };
    await act(() => jest.advanceTimersByTime(7999));
    await fireEvent(screen.getByTestId(panelId), 'pointerEnter', { nativeEvent: { pointerType: 'touch' } });
    await fireEvent(button, 'responderGrant', event);
    await act(() => jest.advanceTimersByTime(200));
    await fireEvent(button, 'responderTerminate', event);
    // Native pointer cancellation also generates pointerLeave for a direct touch pointer.
    await fireEvent(screen.getByTestId(panelId), 'pointerLeave', { nativeEvent: { pointerType: 'touch' } });
    expect(undo).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1999));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test('unmounting a focused, hovered, pressed panel does not dismiss its replacement', async () => {
    const oldDismiss = jest.fn();
    const newDismiss = jest.fn();
    const old = await render(panel(oldDismiss));
    await fireEvent(old.getByTestId(panelId), 'pointerEnter');
    await fireEvent(old.getByTestId(undoId), 'focus');
    await fireEvent(old.getByTestId(undoId), 'pressIn');
    await old.unmount();
    const replacement = await render(panel(newDismiss));
    await act(() => jest.advanceTimersByTime(7999));
    expect(oldDismiss).not.toHaveBeenCalled();
    expect(newDismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(newDismiss).toHaveBeenCalledTimes(1);
    await replacement.unmount();
    await act(() => jest.advanceTimersByTime(60000));
    expect(oldDismiss).not.toHaveBeenCalled();
    expect(newDismiss).toHaveBeenCalledTimes(1);
  });

  test('CL-12 ruled by design: web expires at eight seconds despite a positive screen-reader query', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const dismiss = jest.fn();
    await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(7999));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each(['undo', 'dismiss'] as const)('CL-12 ruled by design: web focus on %s pauses until blur', async (target) => {
    jest.replaceProperty(Platform, 'OS', 'web');
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const dismiss = jest.fn();
    const screen = await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(7999));
    const button = screen.getByTestId(target === 'undo' ? undoId : dismissId);
    await fireEvent(button, 'focus');
    await act(() => jest.advanceTimersByTime(60000));
    expect(dismiss).not.toHaveBeenCalled();
    await fireEvent(button, 'blur');
    await act(() => jest.advanceTimersByTime(1999));
    expect(dismiss).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test.each(['ios', 'android'] as const)('CL-12 ruled by design: %s screen reader keeps the panel', async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const dismiss = jest.fn();
    await render(panel(dismiss));
    await act(() => jest.advanceTimersByTime(60000));
    expect(dismiss).not.toHaveBeenCalled();
  });
});
