import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';

import type { ItemCandidate } from '@/api';
import { DateChoices, localDate, parseLocalDate, relativeDate } from '@/components/ui/date-sheet';
import { EditSheet } from '@/components/ui/edit-sheet';
import { FoodEditSheet, FoodSummary, type FoodValues } from '@/components/ui/food-summary';
import { FadeIn } from '@/components/ui/fade-in';
import { draftError, needsSpoiledDecision, toCreateItem } from '@/features/add/candidate-editor';
import { CandidateReview, reviewDrafts, type ReviewDraft } from '@/features/add/candidate-review';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { PreferencesProvider } from '@/settings/preferences';
import { createTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => true) }));

const food: FoodValues = { name: 'Apples', quantity: 1, unit: 'piece', storage: 'fridge', food_group: 'fruit', predicted_expiry: '2028-01-31', freshness: 'fresh' };
const candidate: ItemCandidate = { ...food, predicted_expiry: '2028-01-31', category: 'produce_hardy', freshness: 'fresh', expiry_source: 'default', confidence: 0.9, photo_token: 'qa-crop', photo_preview_url: 'file:///qa-crop.jpg', est_price: null };
const store = { get: async () => null, set: async () => {}, delete: async () => {} };

beforeEach(() => { jest.clearAllMocks(); jest.mocked(useReducedMotion).mockReturnValue(true); });
afterEach(() => jest.restoreAllMocks());

async function review(candidates: ItemCandidate[], source: 'photo' | 'text' | 'receipt' | 'barcode' = 'photo', changed = jest.fn<void, [ReviewDraft]>()) {
  function Harness() {
    const [drafts, setDrafts] = useState(reviewDrafts(candidates, source));
    return <PreferencesProvider store={store}><CandidateReview drafts={drafts} screen="qa" receipt={source === 'receipt'} disabled={false}
      onChange={(id, patch) => setDrafts((current) => current.map((draft) => {
        if (draft.id !== id) return draft;
        const next = { ...draft, ...patch }; changed(next); return next;
      }))} /></PreferencesProvider>;
  }
  return { screen: await render(<Harness />), changed };
}

test.each(['ios', 'android', 'web'] as const)('%s summary rows expose field/value/button, scalable text and 44 pt minimums', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const edit = jest.fn();
  const screen = await render(<FoodSummary values={food} estimated onEdit={edit} testID="qa" />);
  expect(screen.getByRole('button', { name: 'Stored in, Fridge' })).toBeTruthy();
  for (const field of ['storage', 'expiry', 'freshness', 'group', 'amount']) {
    const row = screen.getByTestId(`qa.${field}.row`);
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    for (const text of within(row).getAllByText(/.+/)) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier ?? 0).toBe(0);
      expect(text.props.numberOfLines).toBeUndefined();
    }
    await fireEvent.press(row);
    expect(edit).toHaveBeenLastCalledWith(field);
  }
});

test.each([
  ['name', '', 'Enter a food name.'], ['name', '   ', 'Enter a food name.'],
  ['quantity', '0', 'Enter a quantity greater than zero.'], ['quantity', '-1', 'Enter a quantity greater than zero.'],
  ['quantity', 'apples', 'Enter a quantity greater than zero.'], ['quantity', '', 'Enter a quantity greater than zero.'],
  ['quantity', 'Infinity', 'Enter a quantity greater than zero.'], ['unit', ' ', 'Enter a unit.'],
])('Name & amount rejects invalid %s %j without saving', async (field, value, message) => {
  const save = jest.fn(async () => {});
  const screen = await render(<FoodEditSheet field="amount" values={food} estimated onSave={save} onClose={jest.fn()} testID="qa" />);
  await fireEvent.changeText(screen.getByTestId(`qa.${field}.input`), value);
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByTestId('qa.save')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('qa.save'));
  expect(save).not.toHaveBeenCalled();
});

test('Name & amount accepts a long name and decimal quantity, trims fields and saves once', async () => {
  let resolve!: () => void;
  const save = jest.fn<Promise<void>, [unknown]>(() => new Promise<void>((done) => { resolve = done; }));
  const close = jest.fn();
  const screen = await render(<FoodEditSheet field="amount" values={food} estimated onSave={save} onClose={close} testID="qa" />);
  const name = 'A'.repeat(200);
  expect(screen.getByTestId('qa.name.input')).toHaveProp('maxLength', 200);
  await fireEvent.changeText(screen.getByTestId('qa.name.input'), name);
  await fireEvent.changeText(screen.getByTestId('qa.quantity.input'), ' 0.25 ');
  await fireEvent.changeText(screen.getByTestId('qa.unit.input'), ' kg ');
  const button = screen.getByTestId('qa.save');
  await fireEvent.press(button); await fireEvent.press(button);
  expect(save.mock.calls).toEqual([[{ name, quantity: 0.25, unit: 'kg' }]]);
  expect(close).not.toHaveBeenCalled();
  await act(() => resolve());
  expect(close).toHaveBeenCalledTimes(1);
});

test.each([
  ['storage', 'freezer', { storage: 'freezer' }], ['group', 'veggies', { food_group: 'veggies' }],
  ['freshness', 'spoiled', { freshness: 'spoiled' }], ['freshness', 'unknown', { freshness: null }],
] as const)('%s sheet contains only its choice and duplicate taps submit once', async (field, option, patch) => {
  let resolve!: () => void;
  const save = jest.fn<Promise<void>, [unknown]>(() => new Promise<void>((done) => { resolve = done; }));
  const close = jest.fn();
  const screen = await render(<FoodEditSheet field={field} values={food} estimated onSave={save} onClose={close} testID="qa" />);
  expect(screen.queryByTestId('qa.save')).toBeNull();
  expect(screen.queryByTestId('qa.name.input')).toBeNull();
  expect(screen.queryByTestId('qa.date.quick.0')).toBeNull();
  const choice = screen.getByTestId(`qa.${field}.${option}`);
  await fireEvent.press(choice); await fireEvent.press(choice);
  expect(save.mock.calls).toEqual([[patch]]);
  await act(() => resolve());
  expect(close).toHaveBeenCalledTimes(1);
});

test.each([null, 0.49, 0.5, 0] as const)('Check this confidence boundary %s is text plus icon', async (confidence) => {
  const { screen } = await review([{ ...candidate, confidence }]);
  const badge = screen.queryByTestId('qa.check.0');
  if (confidence != null && confidence < 0.5) {
    expect(badge).toBeTruthy();
    expect(within(badge!).getByText('Check this')).toBeTruthy();
    expect(within(badge!).getAllByText(/.+/, { includeHiddenElements: true }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('qa.edit.0').props.accessibilityLabel).toContain('Check this');
  } else expect(badge).toBeNull();
});

test.each(['photo', 'text', 'receipt', 'barcode'] as const)('%s review stably sorts uncertain/non-food first, preserving equal-priority order after edits', async (source) => {
  const { screen } = await review([
    { ...candidate, name: 'Certain A' }, { ...candidate, name: 'Uncertain A', confidence: 0.49 },
    { ...candidate, name: 'Certain B', confidence: null }, { ...candidate, name: 'Dish soap', confidence: 0.99 },
    { ...candidate, name: 'Uncertain B', confidence: 0.1 }, { ...candidate, name: 'Certain C', confidence: 0.5 },
    { ...candidate, name: 'Old certain', freshness: 'spoiled' }, { ...candidate, name: 'Old uncertain', freshness: 'spoiled', confidence: 0.1 },
  ], source);
  const order = () => screen.getAllByTestId(/^qa\.candidate\./).map((row) => row.props.testID);
  const expected = [1, 3, 4, 0, 2, 5, 7, 6].map((id) => `qa.candidate.${id}`);
  expect(order()).toEqual(expected);
  expect(within(screen.getByTestId('qa.check.3')).getByText('Check this')).toBeTruthy();
  expect(screen.getByTestId('qa.select.3').props.accessibilityState.checked).toBe(source !== 'receipt');
  await fireEvent.press(screen.getByTestId('qa.edit.2'));
  await fireEvent.press(screen.getByTestId('qa.editor.2.storage.row'));
  await fireEvent.press(screen.getByTestId('qa.editor.2.storage.pantry'));
  expect(order()).toEqual(expected);
});

test('candidate re-confirmation retains estimated date; another date becomes user-sourced', async () => {
  const { screen, changed } = await review([candidate]);
  for (const date of ['2028-01-31', '2028-01-30', '2028-01-30']) {
    await fireEvent.press(screen.getByTestId('qa.edit.0'));
    const estimated = date === '2028-01-31';
    if (changed.mock.calls.length > 0) {
      expect(screen.getByTestId('qa.editor.0.expiry.row').props.accessibilityLabel.includes('estimated')).toBe(changed.mock.calls.at(-1)![0].expiry === candidate.predicted_expiry);
    }
    await fireEvent.press(screen.getByTestId('qa.editor.0.expiry.row'));
    await fireEvent.press(screen.getByTestId(`qa.editor.0.date.day.${date}`));
    expect(toCreateItem(changed.mock.calls.at(-1)![0], 'fridge')).toMatchObject({ predicted_expiry: date, expiry_source: estimated ? 'default' : 'user', photo_token: 'qa-crop' });
  }
});

test('CL-21: marking a previously fresh candidate Looks off requires Toss or Keep before Add', async () => {
  const { screen, changed } = await review([candidate]);
  await fireEvent.press(screen.getByTestId('qa.edit.0'));
  await fireEvent.press(screen.getByTestId('qa.editor.0.freshness.row'));
  await fireEvent.press(screen.getByTestId('qa.editor.0.freshness.spoiled'));
  const current = changed.mock.calls.at(-1)![0];
  expect(toCreateItem(current, 'fridge').freshness).toBe('spoiled');
  expect({ decisionRequired: needsSpoiledDecision(current), error: draftError(current), choices: Boolean(screen.queryByTestId('qa.toss.0')) })
    .toEqual({ decisionRequired: true, error: 'Choose Toss or Keep for food that looks spoiled.', choices: true });
});

test('original spoiled candidates retain Toss/Keep requirements through reselection', async () => {
  const { screen, changed } = await review([{ ...candidate, freshness: 'spoiled' }]);
  expect(needsSpoiledDecision(reviewDrafts([{ ...candidate, freshness: 'spoiled' }], 'photo')[0])).toBe(true);
  await fireEvent.press(screen.getByTestId('qa.toss.0'));
  expect(changed.mock.calls.at(-1)![0]).toMatchObject({ selected: false, spoilDecision: 'toss' });
  await fireEvent.press(screen.getByTestId('qa.select.0'));
  expect(needsSpoiledDecision(changed.mock.calls.at(-1)![0])).toBe(true);
  await fireEvent.press(screen.getByTestId('qa.keep.0'));
  expect(draftError(changed.mock.calls.at(-1)![0])).toBeUndefined();
  expect(changed.mock.calls.at(-1)![0]).toMatchObject({ selected: true, spoilDecision: 'keep' });
});

test.each([
  [2027, 0, 31, '2027-02-28'], [2028, 0, 31, '2028-02-29'],
  [2028, 1, 29, '2028-03-31'], [2027, 11, 31, '2028-01-31'],
])('month navigation from %s-%s-%s reaches the adjacent month without day overflow', async (year, month, day, last) => {
  const select = jest.fn();
  const now = new Date(year, month, day, 23, 59);
  const screen = await render(<DateChoices value={localDate(now)} now={now} onSelect={select} />);
  await fireEvent.press(screen.getByTestId('date.next'));
  await fireEvent.press(screen.getByTestId(`date.day.${last}`));
  expect(select).toHaveBeenCalledWith(last);
  await fireEvent.press(screen.getByTestId('date.previous'));
  expect(screen.getByTestId(`date.day.${localDate(now)}`)).toHaveProp('accessibilityState', { selected: true, disabled: false });
});

test.each([
  ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2027-12-31', '2028-01-01'],
  ['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'], ['2026-10-31', '2026-11-01'], ['2026-11-01', '2026-11-02'],
])('Tomorrow stays a local day across %s -> %s', async (today, tomorrow) => {
  const now = parseLocalDate(today); now.setHours(23, 59);
  const select = jest.fn();
  const screen = await render(<DateChoices value={today} now={now} onSelect={select} />);
  await fireEvent.press(screen.getByTestId('date.quick.1'));
  expect(select).toHaveBeenCalledWith(tomorrow);
  expect(relativeDate(tomorrow, now)).toBe('in 1 day');
  expect(relativeDate(today, parseLocalDate(tomorrow))).toBe('Expired 1 day ago');
  expect(localDate(now)).toBe(today);
});

test('today ring is independent of selection; past days remain selectable with 44 pt cells', async () => {
  const now = new Date(2028, 1, 29, 0, 1);
  const select = jest.fn();
  const screen = await render(<DateChoices value="2028-02-27" now={now} onSelect={select} />);
  const today = screen.getByTestId('date.day.2028-02-29');
  expect(today).toHaveStyle({ borderColor: createTheme('light').colors.forest });
  expect(today).toHaveProp('accessibilityHint', 'Today');
  const past = screen.getByTestId('date.day.2028-02-27');
  expect(past).toHaveTextContent('27 ✓');
  expect(past).toHaveProp('accessibilityState', { selected: true, disabled: false });
  expect(past).toHaveStyle({ minWidth: 44, minHeight: 44 });
  await fireEvent.press(past); expect(select).toHaveBeenCalledWith('2028-02-27');
});

test.each(['ios', 'android', 'web'] as const)('%s sheet marks modal scope, constrains width and supports request-close/cancel', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const close = jest.fn();
  const screen = await render(<EditSheet title="Stored in" testID="qa" onClose={close}><Text>Choices</Text></EditSheet>);
  expect(screen.getByTestId('qa.panel')).toHaveProp('accessibilityViewIsModal', true);
  expect(screen.getByTestId('qa.panel')).toHaveStyle({ width: '100%', maxWidth: 520, alignSelf: 'center' });
  await fireEvent(screen.getByTestId('qa'), 'requestClose');
  expect(close).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('qa.cancel'));
  expect(close).toHaveBeenCalledTimes(2);
});

test('Reduce Motion suppresses slide transitions in sheets', async () => {
  const screen = await render(<EditSheet title="Stored in" testID="qa" onClose={jest.fn()}><Text>Choices</Text></EditSheet>);
  expect(screen.getByTestId('qa')).toHaveProp('animationType', 'fade');
  jest.mocked(useReducedMotion).mockReturnValue(false);
  await screen.rerender(<EditSheet title="Stored in" testID="qa" onClose={jest.fn()}><Text>Choices</Text></EditSheet>);
  expect(screen.getByTestId('qa')).toHaveProp('animationType', 'slide');
});

test('CL-22: Reduce Motion leaves summary/review FadeIn content immediately visible without animation', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const screen = await render(<FadeIn testID="qa.fade"><Text>Food summary</Text></FadeIn>);
  expect({ animations: timing.mock.calls.length, opacity: StyleSheet.flatten(screen.getByTestId('qa.fade').props.style).opacity })
    .toEqual({ animations: 0, opacity: 1 });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, b] = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test.each(['light', 'dark'] as const)('%s summary/sheet/check/notice token pairs meet AA contrast and today ring contrast', (scheme) => {
  const { colors } = createTheme(scheme);
  for (const foreground of [colors.ink, colors.inkSecondary, colors.muted, colors.urgentInk]) {
    for (const background of [colors.surface, colors.ground]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(colors.onForest, colors.forest)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.forest, colors.ground)).toBeGreaterThanOrEqual(3);
});
