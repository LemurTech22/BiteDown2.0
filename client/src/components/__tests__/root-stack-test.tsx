import { render } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

import RootLayout from '@/app/_layout';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: Object.assign(
      ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
      { Screen: jest.fn(() => null) },
    ),
  };
});
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@/api', () => ({ ApiProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/auth/auth-provider', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/settings/preferences', () => ({ PreferencesProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/components/global-banners', () => ({ GlobalBanners: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: ({ children }: { children: ReactNode }) => children }));

test('uses custom headers for feature screens, keeps Debug native, and preserves modal navigation', async () => {
  await render(<RootLayout />);
  const registrations = (Stack.Screen as unknown as jest.Mock).mock.calls.map(([props]) => props);
  const options = (name: string) => {
    const registration = registrations.find((props) => props.name === name);
    expect(registration).toBeDefined();
    return registration.options;
  };

  for (const route of [
    'item/[id]', 'add-text', 'add-barcode', 'add-receipt', 'recipes/index', 'recipes/[id]', 'settings',
    'social/pantry', 'social/request-new', 'social/my-requests', 'social/claimed/[id]',
    'social/connect', 'social/scan', 'social/group/[id]',
  ]) {
    expect(options(route).headerShown).toBe(false);
  }
  expect(options('debug').headerShown).not.toBe(false);
  expect(options('debug').title).toBe('Server settings');
  for (const route of ['add-modal', 'add-text', 'add-barcode', 'add-receipt', 'social/request-new', 'social/scan']) {
    expect(options(route).presentation).toBe('modal');
  }
});
