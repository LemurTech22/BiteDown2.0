import { render } from '@testing-library/react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';

import FriendRoute from '@/app/friend/[code]';
import GroupRoute from '@/app/group/[code]';
import { useAuth } from '@/auth/auth-provider';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/auth/auth-provider', () => ({ useAuth: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ code: 'Invite_Code-123' });
  jest.mocked(useAuth).mockReturnValue({ status: 'authenticated' } as ReturnType<typeof useAuth>);
});

describe.each([
  ['friend', FriendRoute, { pathname: '/social/scan', params: { code: 'Invite_Code-123' } }],
  ['group', GroupRoute, { pathname: '/social/connect', params: { invite: 'Invite_Code-123' } }],
] as const)('%s deep link', (_name, Route, target) => {
  test('redirects with the code', async () => {
    await render(<Route />);
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toEqual(target);
  });

  test('sends signed-out users to login', async () => {
    jest.mocked(useAuth).mockReturnValue({ status: 'unauthenticated' } as ReturnType<typeof useAuth>);
    await render(<Route />);
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toBe('/login');
  });

  test('waits for session restoration before redirecting', async () => {
    jest.mocked(useAuth).mockReturnValue({ status: 'loading' } as ReturnType<typeof useAuth>);
    const screen = await render(<Route />);
    expect(Redirect).not.toHaveBeenCalled();
    jest.mocked(useAuth).mockReturnValue({ status: 'authenticated' } as ReturnType<typeof useAuth>);
    await screen.rerender(<Route />);
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toEqual(target);
  });

  test('uses the existing session error screen when restoration fails', async () => {
    jest.mocked(useAuth).mockReturnValue({ status: 'error' } as ReturnType<typeof useAuth>);
    await render(<Route />);
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toBe('/');
  });
});
