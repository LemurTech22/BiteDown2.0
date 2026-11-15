import { MockApiClient } from '@/api/mock-client';
import type { Item, ItemCategory, Storage } from '@/api/types';

const LIFE: Record<ItemCategory, [number, number, number]> = {
  produce_leafy: [5, 2, 240], produce_hardy: [21, 7, 300], dairy: [10, 1, 90],
  meat: [3, 1, 180], seafood: [2, 1, 120], bakery: [10, 4, 90], eggs: [28, 7, 120],
  leftovers: [4, 1, 90], pantry_dry: [180, 365, 365], frozen: [2, 1, 270], other: [7, 30, 90],
};
const STORAGES: Storage[] = ['fridge', 'pantry', 'freezer'];
const isoIn = (days: number) => new Date(Date.parse('2026-11-13') + days * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'cp18@example.com', password: 'password123', display_name: 'Contributor' });
  return api;
}

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-13T12:00:00Z')));
afterEach(() => jest.useRealTimers());

test('all category/storage pairs agree with the backend contract at date boundaries', async () => {
  const api = await setup();
  for (const category of Object.keys(LIFE) as ItemCategory[]) {
    const row = LIFE[category];
    for (const old of STORAGES) for (const storage of STORAGES) {
      if (old === storage) continue;
      const oldDays = row[STORAGES.indexOf(old)], newDays = row[STORAGES.indexOf(storage)];
      for (const left of [null, -2, 0, 1, 2, 7, 30, 400]) {
        const { items: [item] } = await api.createItems({ items: [{ name: 'Food', category, storage: old,
          predicted_expiry: isoIn(left ?? 1), expiry_source: 'default' }] });
        // Historical null fixture: the public PATCH contract does not accept null dates.
        if (left === null) (api as unknown as { items: Item[] }).items.find((entry) => entry.id === item.id)!.predicted_expiry = null;
        let expected: number;
        if (left === null) expected = newDays;
        else if (storage === 'freezer') expected = left < 0 ? left : newDays;
        else if (old === 'freezer') expected = Math.min(newDays, ({ meat: 2, seafood: 2, leftovers: 3 } as Partial<Record<ItemCategory, number>>)[category] ?? newDays);
        else if (left <= 0) expected = left;
        else {
          // Integer quotient/remainder avoids depending on the implementation's floating-point rounding.
          const numerator = Math.min(left, oldDays) * newDays;
          const quotient = Math.floor(numerator / oldDays), remainder = numerator % oldDays;
          expected = Math.max(1, quotient + Number(2 * remainder > oldDays || (2 * remainder === oldDays && quotient % 2 === 1)));
        }
        const { item: moved } = await api.updateItem(item.id, { storage, reestimate_expiry: true });
        expect({ category, old, storage, left, expiry: moved.predicted_expiry })
          .toEqual({ category, old, storage, left, expiry: isoIn(expected) });
        expect(moved.expiry_source).toBe('default');
      }
    }
  }
});

test('CL-2: freezing agrees with the backend calendar day late in America/Chicago', async () => {
  // Same instant is Nov 13 on this backend host and Nov 14 in UTC.
  jest.setSystemTime(new Date('2026-11-13T23:30:00-06:00'));
  const api = await setup();
  const { items: [item] } = await api.createItems({ items: [{ name: 'Meat', category: 'meat', storage: 'fridge',
    predicted_expiry: '2026-11-15', expiry_source: 'default' }] });
  expect((await api.updateItem(item.id, { storage: 'freezer' })).item.predicted_expiry).toBe(isoIn(180));
});
