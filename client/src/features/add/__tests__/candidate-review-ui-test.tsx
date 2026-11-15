import { fireEvent, render, within } from '@testing-library/react-native';
import { useState } from 'react';

import type { ItemCandidate } from '@/api';
import { PreferencesProvider } from '@/settings/preferences';

import { draftError, needsSpoiledDecision, toCreateItem } from '../candidate-editor';
import { CandidateReview, expiryLabel, reviewDrafts, type ReviewDraft } from '../candidate-review';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
const candidate: ItemCandidate = { name: 'Apples', category: 'produce_hardy', food_group: 'fruit', storage: 'fridge',
  quantity: 1, unit: 'piece', predicted_expiry: '2026-11-21', expiry_source: 'ml', est_price: null,
  freshness: 'fresh', confidence: 0.95, photo_token: 'crop-token', photo_preview_url: 'file:///crop.jpg' };

async function show(candidates: ItemCandidate[], changed = jest.fn()) {
  function Harness() {
    const [drafts, setDrafts] = useState(reviewDrafts(candidates, 'photo'));
    return <PreferencesProvider><CandidateReview drafts={drafts} screen="review" disabled={false} onChange={(id, patch) => {
      setDrafts((current) => current.map((draft) => {
        const next = draft.id === id ? { ...draft, ...patch } : draft;
        if (draft.id === id) changed(next);
        return next;
      }));
    }} /></PreferencesProvider>;
  }
  return render(<Harness />);
}

test('compact checked rows show photo and storage/expiry; only uncertain/non-food candidates are flagged and sorted first per section', async () => {
  const screen = await show([candidate, { ...candidate, name: 'Uncertain', confidence: 0.49 },
    { ...candidate, name: 'No confidence', confidence: null }, { ...candidate, name: 'Boundary', confidence: 0.5 },
    { ...candidate, name: 'Dish soap' }, { ...candidate, name: 'Spoiled', freshness: 'spoiled', confidence: 0.2 }]);
  expect(screen.getAllByTestId(/^review\.candidate\./).map((row) => row.props.testID)).toEqual([
    'review.candidate.1', 'review.candidate.4', 'review.candidate.0', 'review.candidate.2', 'review.candidate.3', 'review.candidate.5',
  ]);
  for (const id of [1, 4, 5]) expect(within(screen.getByTestId(`review.check.${id}`)).getByText('Check this')).toBeTruthy();
  for (const id of [0, 2, 3]) expect(screen.queryByTestId(`review.check.${id}`)).toBeNull();
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  expect(screen.getByTestId('review.select.0')).toHaveProp('accessibilityState', { checked: true, disabled: false });
  expect(screen.getByTestId('review.select.4')).toHaveProp('accessibilityState', { checked: true, disabled: false });
  const expiry = expiryLabel(candidate.predicted_expiry);
  expect(screen.getByTestId('review.expiryBadge.0')).toHaveTextContent(`Fridge · ${['Today', 'Tomorrow', 'Expired', 'Check expiry'].includes(expiry) ? '' : 'use in '}${expiry}`);
  expect(within(screen.getByTestId('review.candidate.0')).getByTestId('itemThumb.photo', { includeHiddenElements: true }).props.source[0].uri).toBe('file:///crop.jpg');
});

test('shared sheets change draft fields and Add payload while preserving the crop token', async () => {
  const changed = jest.fn<void, [ReviewDraft]>();
  const screen = await show([candidate], changed);
  async function edit(field: string) {
    await fireEvent.press(screen.getByTestId('review.edit.0'));
    await fireEvent.press(screen.getByTestId(`review.editor.0.${field}.row`));
  }
  await edit('amount');
  await fireEvent.changeText(screen.getByTestId('review.editor.0.name.input'), 'Green apples');
  await fireEvent.changeText(screen.getByTestId('review.editor.0.quantity.input'), '2');
  await fireEvent.changeText(screen.getByTestId('review.editor.0.unit.input'), 'bag');
  await fireEvent.press(screen.getByTestId('review.editor.0.save'));
  expect(screen.queryByTestId('review.editor.0.sheet')).toBeNull();
  await edit('storage');
  await fireEvent.press(screen.getByTestId('review.editor.0.storage.pantry'));
  await edit('group');
  await fireEvent.press(screen.getByTestId('review.editor.0.group.veggies'));
  await edit('freshness');
  await fireEvent.press(screen.getByTestId('review.editor.0.freshness.unknown'));
  await edit('expiry');
  await fireEvent.press(screen.getByTestId('review.editor.0.date.day.2026-11-22'));
  const draft = changed.mock.calls.at(-1)![0];
  expect(toCreateItem(draft, 'fridge')).toMatchObject({ name: 'Green apples', quantity: 2, unit: 'bag', storage: 'pantry',
    food_group: 'veggies', freshness: null, predicted_expiry: '2026-11-22', expiry_source: 'user', photo_token: 'crop-token' });
});

test('spoiled section requires Toss/Keep and records the decision independently of edits', async () => {
  const changed = jest.fn<void, [ReviewDraft]>();
  const screen = await show([{ ...candidate, freshness: 'spoiled' }], changed);
  expect(screen.getByText('Looks spoiled')).toBeTruthy();
  expect(needsSpoiledDecision(reviewDrafts([{ ...candidate, freshness: 'spoiled' }], 'photo')[0])).toBe(true);
  await fireEvent.press(screen.getByTestId('review.keep.0'));
  expect(draftError(changed.mock.calls.at(-1)![0])).toBeUndefined();
  expect(changed.mock.calls.at(-1)![0]).toMatchObject({ selected: true, spoilDecision: 'keep' });
  await fireEvent.press(screen.getByTestId('review.toss.0'));
  expect(changed.mock.calls.at(-1)![0]).toMatchObject({ selected: false, spoilDecision: 'toss' });
});

test.each(['fresh', 'semi_fresh'] as const)('changing freshness back to %s clears the spoiled section and decision', async (freshness) => {
  const changed = jest.fn<void, [ReviewDraft]>();
  const screen = await show([candidate], changed);
  async function editFreshness(value: string) {
    await fireEvent.press(screen.getByTestId('review.edit.0'));
    await fireEvent.press(screen.getByTestId('review.editor.0.freshness.row'));
    await fireEvent.press(screen.getByTestId(`review.editor.0.freshness.${value}`));
  }
  await editFreshness('spoiled');
  expect(screen.getByText('Looks spoiled')).toBeTruthy();
  expect(needsSpoiledDecision(changed.mock.calls.at(-1)![0])).toBe(true);
  await fireEvent.press(screen.getByTestId('review.keep.0'));
  await editFreshness(freshness);
  expect(screen.queryByText('Looks spoiled')).toBeNull();
  expect(screen.queryByTestId('review.keep.0')).toBeNull();
  const draft = changed.mock.calls.at(-1)![0];
  expect(draft.spoilDecision).toBeUndefined();
  expect(draftError(draft)).toBeUndefined();
  expect(toCreateItem(draft, 'fridge').freshness).toBe(freshness);
  await editFreshness('spoiled');
  expect(needsSpoiledDecision(changed.mock.calls.at(-1)![0])).toBe(true);
  expect(draftError(changed.mock.calls.at(-1)![0])).toBe('Choose Toss or Keep for food that looks spoiled.');
});
