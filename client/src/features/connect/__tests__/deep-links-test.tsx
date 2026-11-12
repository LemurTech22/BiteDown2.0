import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import FriendRoute from '@/app/friend/[code]';
import GroupRoute from '@/app/group/[code]';
import LogInRoute from '@/app/login';
import SignUpRoute from '@/app/signup';
import { useAuth } from '@/auth/auth-provider';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  useLocalSearchParams: jest.fn(),
  router: { replace: jest.fn(), back: jest.fn() },
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

  test.each(['login', 'signup'] as const)('preserves signed-out codes through %s and authenticated route rendering', async (mode) => {
    const authenticate = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useAuth).mockReturnValue({ status: 'unauthenticated', login: authenticate, signup: authenticate } as unknown as ReturnType<typeof useAuth>);
    const screen = await render(<Route />);
    const next = `${target.pathname}?${new URLSearchParams(target.params)}`;
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toEqual({ pathname: '/login', params: { next } });

    jest.mocked(useLocalSearchParams).mockReturnValue({ next });
    await screen.rerender(<LogInRoute />);
    if (mode === 'signup') {
      await fireEvent.press(screen.getByTestId('login.signup.link'));
      expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/signup', params: { next } });
      await screen.rerender(<SignUpRoute />);
      await fireEvent.changeText(screen.getByTestId('signup.name.input'), 'Demo User');
    }
    await fireEvent.changeText(screen.getByTestId(`${mode}.email.input`), 'demo@example.com');
    await fireEvent.changeText(screen.getByTestId(`${mode}.password.input`), 'password-for-demo');
    await fireEvent.press(screen.getByTestId(`${mode}.submit.button`));
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith(next));
    expect(authenticate).toHaveBeenCalledTimes(1);

    jest.mocked(useAuth).mockReturnValue({ status: 'authenticated' } as ReturnType<typeof useAuth>);
    await screen.rerender(mode === 'login' ? <LogInRoute /> : <SignUpRoute />);
    expect(jest.mocked(Redirect).mock.calls.at(-1)![0].href).toBe(next);
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

describe.each([LogInRoute, SignUpRoute])('authenticated auth route', (Route) => {
  test.each([
    undefined,
    'https://evil.example',
    '//evil',
    '/home',
    '/social/../home',
    '/social/%2e%2e/home',
    '/social//evil',
    '/social/%2f%2fevil',
    '/social/https:evil',
    '/social/\\evil',
    '/social/%',
    ['/social/scan', '//evil'],
  ].map((next) => ({ next })))('falls back to home for unsafe next $next', async ({ next }) => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ next });
    await render(<Route />);
    expect(jest.mocked(Redirect).mock.calls[0][0].href).toBe('/home');
  });
});
