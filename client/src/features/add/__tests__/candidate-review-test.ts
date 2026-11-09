import type { ItemCandidate } from '@/api';

import { expiryLabel, reviewDrafts } from '../candidate-review';

function dateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('expiry vocabulary follows the design ranges and keeps edited dates exact', () => {
  expect(expiryLabel(dateAfter(-1))).toBe('Expired');
  expect(expiryLabel(dateAfter(0))).toBe('Today');
  expect(expiryLabel(dateAfter(1))).toBe('Tomorrow');
  expect(expiryLabel(dateAfter(3))).toBe('2–3 days');
  expect(expiryLabel(dateAfter(7))).toBe('6–7 days');
  expect(expiryLabel(dateAfter(8))).toBe('1–2 weeks');
  expect(expiryLabel(dateAfter(15))).toBe('2–3 weeks');
  expect(expiryLabel(dateAfter(22))).toBe('3+ weeks');
  const exact = expiryLabel(dateAfter(7), false);
  expect(exact).not.toContain('–');
  expect(exact).not.toContain('weeks');
});

test('unknown food stays selected while recognizable non-food receipt lines start unticked', () => {
  const candidate: ItemCandidate = { name: 'Mystery food', category: 'other', food_group: 'other', storage: 'pantry',
    quantity: 1, unit: 'piece', est_price: null, predicted_expiry: dateAfter(7), expiry_source: 'default' };
  const drafts = reviewDrafts([candidate, { ...candidate, name: 'Paper towels', receipt_text: 'BTY PPR TWL 6R 11.99' }], 'receipt');
  expect(drafts[0]).toMatchObject({ selected: true, nonFood: false });
  expect(drafts[1]).toMatchObject({ selected: false, nonFood: true });
});
