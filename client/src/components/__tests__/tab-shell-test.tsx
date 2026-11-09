import { fireEvent, render } from '@testing-library/react-native';
import { router, Tabs } from 'expo-router';
import type { ReactNode } from 'react';

import TabLayout from '@/app/(tabs)/_layout';
import AddModalScreen from '@/app/add-modal';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    Redirect: jest.fn(() => null),
    router: { back: jest.fn(), push: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    Tabs: Object.assign(
      ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
      { Screen: jest.fn(() => null) },
    ),
  };
});

jest.mock('@/auth/auth-provider', () => ({
  useAuth: () => ({ status: 'authenticated' }),
}));

describe('tab shell', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses the requested order and opens Add as a modal', async () => {
    await render(<TabLayout />);
    const screen = Tabs.Screen as unknown as jest.Mock;
    const configurations = screen.mock.calls.map(([props]) => props);

    expect(configurations.map((props) => props.name)).toEqual(['home', 'fridge', 'add', 'social', 'impact']);
    expect(configurations.map((props) => props.options.tabBarButtonTestID)).toEqual([
      'tabs.home.button',
      'tabs.fridge.button',
      'tabs.add.button',
      'tabs.social.button',
      'tabs.impact.button',
    ]);

    const add = configurations.find((props) => props.name === 'add');
    const preventDefault = jest.fn();
    add.listeners.tabPress({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/add-modal');
  });

  test('closes the Add modal', async () => {
    const view = await render(<AddModalScreen />);
    await fireEvent.press(view.getByTestId('add.close.button'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
