import { fireEvent, render } from '@testing-library/react-native';

import { DateChoices, DateSheet, localDate, relativeDate } from '../date-sheet';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
const now = new Date(2026, 10, 14, 23, 59);

test.each([[0, '2026-11-14'], [1, '2026-11-15'], [3, '2026-11-17'], [7, '2026-11-21'], [14, '2026-11-28']])(
  'quick pick %s emits a local API date', async (offset, expected) => {
    const select = jest.fn();
    const screen = await render(<DateChoices value="2026-11-14" now={now} onSelect={select} />);
    await fireEvent.press(screen.getByTestId(`date.quick.${offset}`));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(expected);
  });

test('navigates months across years and allows past-day selection with full accessible labels', async () => {
  const select = jest.fn();
  const screen = await render(<DateChoices value="2026-12-14" now={now} onSelect={select} />);
  await fireEvent.press(screen.getByLabelText('Next month'));
  expect(screen.getByTestId('date.month')).toHaveTextContent('January 2027');
  await fireEvent.press(screen.getByLabelText('Previous month'));
  await fireEvent.press(screen.getByLabelText('Previous month'));
  expect(screen.getByTestId('date.month')).toHaveTextContent('November 2026');
  const past = screen.getByTestId('date.day.2026-11-01');
  expect(past).toHaveProp('accessibilityLabel', new Date(2026, 10, 1).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }));
  await fireEvent.press(past);
  expect(select).toHaveBeenCalledWith('2026-11-01');
});

test('selected day has a check and selected state; today has a ring and hint; disabled dates do not emit', async () => {
  const select = jest.fn();
  const screen = await render(<DateChoices value="2026-11-13" now={now} onSelect={select} disabled />);
  expect(screen.getByTestId('date.day.2026-11-13')).toHaveProp('accessibilityState', { selected: true, disabled: true });
  expect(screen.getByTestId('date.day.2026-11-13')).toHaveTextContent('13 ✓');
  expect(screen.getByTestId('date.day.2026-11-14')).toHaveProp('accessibilityHint', 'Today');
  await fireEvent.press(screen.getByTestId('date.day.2026-11-13'));
  await fireEvent.press(screen.getByTestId('date.quick.0'));
  expect(select).not.toHaveBeenCalled();
});

test('sheet respects Reduce Motion and cancellation, local dates avoid UTC conversion', async () => {
  const close = jest.fn();
  const screen = await render(<DateSheet value="2026-11-14" now={now} onSelect={jest.fn()} onClose={close} />);
  expect(screen.getByTestId('date.sheet')).toHaveProp('animationType', 'fade');
  await fireEvent.press(screen.getByTestId('date.sheet.cancel'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(localDate(now)).toBe('2026-11-14');
  expect(localDate(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
  expect(relativeDate('2026-11-21', now)).toBe('in 7 days');
  expect(relativeDate('2026-11-12', now)).toBe('Expired 2 days ago');
});
