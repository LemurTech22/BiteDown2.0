import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet } from 'react-native';

import type { Item } from '@/api';
import { BatchUndoToast } from '@/features/fridge/batch-undo-toast';
import { UndoToast } from '@/features/remove/undo-toast';

const EIGHT_SECONDS = 8000;
const SEVEN_DAYS = 7 * 86400000;
type Kind = 'single' | 'batch';

function Panel({ kind, deadline, pending = false, error = '', onUndo = jest.fn() }: {
  kind: Kind; deadline: number; pending?: boolean; error?: string; onUndo?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  const common = { expiresAt: deadline - EIGHT_SECONDS + SEVEN_DAYS, toastExpiresAt: deadline, error };
  return kind === 'single'
    ? <UndoToast entry={{ ...common, item: { id: 'apple', name: 'Apple' } as Item, restoring: pending }} onUndo={onUndo} onDismiss={() => setVisible(false)} />
    : <BatchUndoToast entry={{ ...common, id: 1, itemIds: ['apple', 'pear'], outcome: 'used', pending }} onUndo={onUndo} onDismiss={() => setVisible(false)} />;
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00Z'));
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe.each(['single', 'batch'] as const)('QA %s Undo', (kind) => {
  const id = kind === 'single' ? 'remove.toast.apple' : 'fridge.batchToast.1';

  test.each(['ios', 'web'] as const)('hides at 8 s on %s, including web reporting a screen reader', async (platform) => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(platform === 'web');
    const screen = await render(<Panel kind={kind} deadline={Date.now() + EIGHT_SECONDS} />);
    await act(() => jest.advanceTimersByTime(EIGHT_SECONDS - 1));
    expect(screen.getByTestId(id)).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByTestId(id)).toBeNull();
  });

  test('Dismiss hides immediately; Undo and Dismiss have labels and targets of at least 44 pt', async () => {
    const undo = jest.fn();
    const screen = await render(<Panel kind={kind} deadline={Date.now() + EIGHT_SECONDS} onUndo={undo} />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(dismiss).toHaveStyle({ minWidth: 44, minHeight: 44 });
    const button = screen.getByRole('button', { name: kind === 'single' ? 'Undo removal of Apple' : 'Undo' });
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(button);
    expect(undo).toHaveBeenCalledTimes(1);
    await fireEvent.press(dismiss);
    expect(screen.queryByTestId(id)).toBeNull();
  });

  test('a pending Undo crossing the deadline and its failure remain visible with a working retry', async () => {
    const deadline = Date.now() + EIGHT_SECONDS;
    const undo = jest.fn();
    const screen = await render(<Panel kind={kind} deadline={deadline} onUndo={undo} />);
    await act(() => jest.advanceTimersByTime(7000));
    await screen.rerender(<Panel kind={kind} deadline={deadline} pending onUndo={undo} />);
    await act(() => jest.advanceTimersByTime(30000));
    expect(screen.getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId(kind === 'single' ? 'remove.undo.apple' : 'fridge.batchUndo.1')).toBeDisabled();
    await screen.rerender(<Panel kind={kind} deadline={deadline} error="Offline" onUndo={undo} />);
    await act(() => jest.advanceTimersByTime(30000));
    expect(screen.getByRole('alert')).toHaveTextContent('Offline');
    await fireEvent.press(screen.getByRole('button', { name: kind === 'single' ? 'Try again to undo removal of Apple' : 'Try again' }));
    expect(undo).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId(id)).toBeNull();
  });

  test('native screen reader keeps the panel past its deadline', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    const screen = await render(<Panel kind={kind} deadline={Date.now() + EIGHT_SECONDS} />);
    await act(() => jest.advanceTimersByTime(60000));
    expect(screen.getByTestId(id)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId(id)).toBeNull();
  });

  test('waits for native accessibility detection and honors a change before the query resolves', async () => {
    let resolve!: (enabled: boolean) => void;
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockImplementation(() => new Promise((done) => { resolve = done; }));
    let changed!: (enabled: boolean) => void;
    const remove = jest.fn();
    const original = AccessibilityInfo.addEventListener;
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, callback) => {
      if (event === 'screenReaderChanged') {
        changed = callback as (enabled: boolean) => void;
        return { remove };
      }
      return original(event, callback);
    });
    const screen = await render(<Panel kind={kind} deadline={Date.now() + EIGHT_SECONDS} />);
    await act(() => jest.advanceTimersByTime(9000));
    expect(screen.getByTestId(id)).toBeTruthy();
    await act(() => { changed(true); resolve(false); });
    await act(() => jest.advanceTimersByTime(9000));
    expect(screen.getByTestId(id)).toBeTruthy();
    await act(() => changed(false));
    await act(() => jest.advanceTimersByTime(0));
    expect(screen.queryByTestId(id)).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('entrance is a short opacity fade with no movement or countdown loop', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const loop = jest.spyOn(Animated, 'loop');
    const screen = await render(<Panel kind={kind} deadline={Date.now() + EIGHT_SECONDS} />);
    expect(timing).toHaveBeenCalled();
    for (const [, config] of timing.mock.calls) {
      expect((config.delay ?? 0) + (config.duration ?? 500)).toBeLessThanOrEqual(500);
      expect(config.toValue).toBe(1);
    }
    expect(StyleSheet.flatten(screen.getByTestId(id).props.style).transform).toBeUndefined();
    expect(loop).not.toHaveBeenCalled();
  });
});
