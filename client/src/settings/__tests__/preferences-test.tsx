import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { formatMoney, formatWeight, PreferencesProvider, usePreferences } from '@/settings/preferences';
import type { KeyValueStore } from '@/storage/key-value-store';

jest.mock('@/storage/key-value-store', () => ({
  deviceStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) },
}));

test.each([
  [1, 'us', '2.2 lb'], [0.1, 'us', '3.5 oz'], [0, 'us', '0.0 lb'],
  [1, 'metric', '1.0 kg'], [0.125, 'metric', '125 g'], [0, 'metric', '0.0 kg'],
] as const)('formatWeight(%s, %s) is %s', (kg, units, expected) => {
  expect(formatWeight(kg, units)).toBe(expected);
});

test.each([
  [12.5, 'USD', '$12.50'], [12.5, 'EUR', '€12.50'], [1234.5, 'USD', '$1,234.50'], [100, 'JPY', '¥100'],
] as const)('formatMoney(%s, %s) is %s', (amount, currency, expected) => {
  expect(formatMoney(amount, currency)).toBe(expected);
});

test('preferences load defaults, persist all settings and restore them on remount', async () => {
  let stored: string | null = null;
  const store: KeyValueStore = { get: async () => stored, set: async (_key, value) => { stored = value; }, delete: async () => {} };
  let preferences!: ReturnType<typeof usePreferences>;
  function Consumer() {
    preferences = usePreferences();
    return <Text>{preferences.currency}</Text>;
  }
  const view = await render(<PreferencesProvider store={store}><Consumer /></PreferencesProvider>);
  await waitFor(() => expect(preferences.hydrated).toBe(true));
  expect(preferences).toMatchObject({ units: 'us', defaultStorage: 'fridge', currency: 'USD', savedPickupSpots: [] });
  const spot = { name: 'Home', note: 'Porch', lat: null, lng: null, place_name: null };
  await act(async () => {
    await preferences.setUnits('metric');
    await preferences.setDefaultStorage('freezer');
    await preferences.setCurrency('EUR');
    await preferences.setSavedPickupSpots([spot]);
  });
  expect(JSON.parse(stored!)).toEqual({ units: 'metric', defaultStorage: 'freezer', currency: 'EUR', savedPickupSpots: [spot] });
  await view.unmount();
  await render(<PreferencesProvider store={store}><Consumer /></PreferencesProvider>);
  await waitFor(() => expect(preferences.hydrated).toBe(true));
  expect(preferences).toMatchObject({ units: 'metric', defaultStorage: 'freezer', currency: 'EUR', savedPickupSpots: [spot] });
});

test('invalid stored preferences safely fall back to defaults', async () => {
  const store: KeyValueStore = { get: async () => '{"units":"bad","defaultStorage":"bad","currency":"bad","savedPickupSpots":[null]}', set: async () => {}, delete: async () => {} };
  let preferences!: ReturnType<typeof usePreferences>;
  function Consumer() { preferences = usePreferences(); return null; }
  await render(<PreferencesProvider store={store}><Consumer /></PreferencesProvider>);
  await waitFor(() => expect(preferences.hydrated).toBe(true));
  expect(preferences).toMatchObject({ units: 'us', defaultStorage: 'fridge', currency: 'USD', savedPickupSpots: [] });
});
