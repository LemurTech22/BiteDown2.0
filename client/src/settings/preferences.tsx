import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { PickupSpot, Storage } from '@/api/types';
import { deviceStore, type KeyValueStore } from '@/storage/key-value-store';

export type Units = 'us' | 'metric';
export interface SavedPickupSpot extends PickupSpot { name: string }
export interface Preferences {
  units: Units;
  defaultStorage: Storage;
  currency: string;
  savedPickupSpots: SavedPickupSpot[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  units: 'us', defaultStorage: 'fridge', currency: 'USD', savedPickupSpots: [],
};
const STORAGE_KEY = 'preferences';

interface PreferencesValue extends Preferences {
  hydrated: boolean;
  error: string | null;
  updatePreferences(patch: Partial<Preferences>): Promise<void>;
  setUnits(units: Units): Promise<void>;
  setDefaultStorage(storage: Storage): Promise<void>;
  setCurrency(currency: string): Promise<void>;
  setSavedPickupSpots(spots: SavedPickupSpot[]): Promise<void>;
}
const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children, store = deviceStore }: { children: ReactNode; store?: KeyValueStore }) {
  const [preferences, setPreferences] = useState<Preferences>(() => ({ ...DEFAULT_PREFERENCES, savedPickupSpots: [] }));
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(preferences);
  const loading = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    loading.current = store.get(STORAGE_KEY).then((raw) => {
      const restored = readPreferences(raw);
      current.current = restored;
      if (active) setPreferences(restored);
    }).catch(() => {
      if (active) setError('Couldn’t load your preferences.');
    }).finally(() => {
      if (active) setHydrated(true);
    });
    return () => { active = false; };
  }, [store]);

  const value = useMemo<PreferencesValue>(() => {
    const updatePreferences = async (patch: Partial<Preferences>) => {
      await loading.current;
      const next = readPreferences(JSON.stringify({ ...current.current, ...patch }));
      current.current = next;
      setPreferences(next);
      const write = writes.current.catch(() => {}).then(() => store.set(STORAGE_KEY, JSON.stringify(next)));
      writes.current = write;
      try {
        await write;
        setError(null);
      } catch (cause) {
        setError('Couldn’t save your preferences.');
        throw cause;
      }
    };
    return {
      ...preferences, hydrated, error, updatePreferences,
      setUnits: (units) => updatePreferences({ units }),
      setDefaultStorage: (defaultStorage) => updatePreferences({ defaultStorage }),
      setCurrency: (currency) => updatePreferences({ currency }),
      setSavedPickupSpots: (savedPickupSpots) => updatePreferences({ savedPickupSpots }),
    };
  }, [preferences, hydrated, error, store]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider.');
  return value;
}

function readPreferences(raw: string | null): Preferences {
  const defaults = { ...DEFAULT_PREFERENCES, savedPickupSpots: [] };
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object') return defaults;
    const data = value as Partial<Preferences>;
    return {
      units: data.units === 'metric' ? 'metric' : 'us',
      defaultStorage: data.defaultStorage === 'freezer' || data.defaultStorage === 'pantry' ? data.defaultStorage : 'fridge',
      currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD',
      savedPickupSpots: Array.isArray(data.savedPickupSpots) ? data.savedPickupSpots.filter(isSavedSpot) : [],
    };
  } catch {
    return defaults;
  }
}

function isSavedSpot(value: unknown): value is SavedPickupSpot {
  if (!value || typeof value !== 'object') return false;
  const spot = value as SavedPickupSpot;
  return typeof spot.name === 'string' && spot.name.trim().length > 0 &&
    (spot.note === null || typeof spot.note === 'string') &&
    (spot.place_name === null || typeof spot.place_name === 'string') &&
    ((spot.lat === null && spot.lng === null) ||
      (typeof spot.lat === 'number' && Number.isFinite(spot.lat) && Math.abs(spot.lat) <= 90 &&
       typeof spot.lng === 'number' && Number.isFinite(spot.lng) && Math.abs(spot.lng) <= 180));
}

export function formatWeight(kg: number, units: Units): string {
  if (units === 'metric') return kg !== 0 && Math.abs(kg) < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(1)} kg`;
  const lb = kg * 2.2046226218;
  return lb !== 0 && Math.abs(lb) < 1 ? `${(lb * 16).toFixed(1)} oz` : `${lb.toFixed(1)} lb`;
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
