import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { ApiError, ApiProvider, MockApiClient, useApi } from '@/api';
import IndexRoute from '@/app/index';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { tokenStore } from '@/auth/token-store';
import { clearServerError } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{href}</Text>;
  },
}));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/auth/token-store', () => ({ tokenStore: { get: jest.fn(), set: jest.fn(async () => {}) } }));
jest.mock('@/storage/key-value-store', () => ({ deviceStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } }));
jest.mock('@/api/config', () => ({ ...jest.requireActual('@/api/config'), DEFAULT_DEMO_MODE: false }));

const tokens = jest.mocked(tokenStore);
beforeEach(() => { jest.clearAllMocks(); clearServerError(); tokens.get.mockResolvedValue(null); });
afterEach(() => { jest.restoreAllMocks(); clearServerError(); });

test('Launch waits for the stored session and routes an unauthenticated user to Landing', async () => {
  let finish!: (value: string | null) => void;
  tokens.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const screen = await render(<ApiProvider client={new MockApiClient()}><AuthProvider><IndexRoute /></AuthProvider></ApiProvider>);
  expect(screen.getByTestId('auth.loading.skeleton')).toBeTruthy();
  await act(async () => finish(null));
  expect(await screen.findByText('Use what you have. Share what you spare.')).toBeTruthy();
  expect(screen.queryByTestId('welcome.session.expired')).toBeNull();
});

test('Launch restores a saved session and routes to Home', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'priya@example.com', password: 'test-password', display_name: 'Priya Raman' });
  tokens.get.mockResolvedValue('saved-token');
  const screen = await render(<ApiProvider client={api}><AuthProvider><IndexRoute /></AuthProvider></ApiProvider>);
  expect(await screen.findByText('/home')).toBeTruthy();
});

test('Launch displays an error and retries a saved session without deleting the token', async () => {
  const api = new MockApiClient();
  await api.signup({ email: 'priya@example.com', password: 'test-password', display_name: 'Priya Raman' });
  jest.spyOn(api, 'me').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Service unavailable'));
  tokens.get.mockResolvedValue('saved-token');
  const screen = await render(<ApiProvider client={api}><AuthProvider><IndexRoute /></AuthProvider></ApiProvider>);
  expect(await screen.findByText('Service unavailable')).toBeTruthy();
  expect(tokens.set).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('auth.error.retry'));
  expect(await screen.findByText('/home')).toBeTruthy();
});

test('a live-client 401 returns to Landing with the exact signed-out banner', async () => {
  tokens.get.mockResolvedValue('expired-token');
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false, status: 401, text: async () => JSON.stringify({ error: { code: 'unauthorized', message: 'Session expired' } }),
  } as Response);
  const screen = await render(<ApiProvider><AuthProvider><IndexRoute /></AuthProvider></ApiProvider>);
  expect(await screen.findByTestId('welcome.session.expired')).toBeTruthy();
  expect(screen.getByText('You were signed out. Log in again to pick up where you left off.')).toBeTruthy();
  expect(tokens.set).toHaveBeenCalledWith(null);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('a 401 on a signed-in screen also expires the session', async () => {
  tokens.get.mockResolvedValue('saved-token');
  jest.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ user: { id: 'priya', email: 'priya@example.com', display_name: 'Priya Raman' }, has_password: true, providers: [] }) } as Response)
    .mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { code: 'unauthorized', message: 'Expired' } }) } as Response);
  function Probe() {
    const { api } = useApi();
    const { status } = useAuth();
    return status === 'authenticated' ? <AppButton label="Load food" testID="test.food.load" onPress={() => { void api.getItems().catch(() => {}); }} /> : null;
  }
  const screen = await render(<ApiProvider><AuthProvider><Probe /><IndexRoute /></AuthProvider></ApiProvider>);
  await fireEvent.press(await screen.findByTestId('test.food.load'));
  expect(await screen.findByTestId('welcome.session.expired')).toBeTruthy();
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('signing out while restoration is in flight cannot restore the stale user', async () => {
  const api = new MockApiClient();
  const result = await api.signup({ email: 'priya@example.com', password: 'test-password', display_name: 'Priya Raman' });
  let finish!: (value: Awaited<ReturnType<typeof api.me>>) => void;
  jest.spyOn(api, 'me').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  tokens.get.mockResolvedValue('saved-token');
  function Probe() {
    const { status, signOut } = useAuth();
    return <><Text>{status}</Text><AppButton label="Sign out" testID="test.auth.signout" onPress={() => { void signOut(); }} /></>;
  }
  const screen = await render(<ApiProvider client={api}><AuthProvider><Probe /></AuthProvider></ApiProvider>);
  await waitFor(() => expect(api.me).toHaveBeenCalled());
  await fireEvent.press(screen.getByTestId('test.auth.signout'));
  await act(async () => finish({ user: result.user, has_password: true, providers: [] }));
  expect(screen.getByText('unauthenticated')).toBeTruthy();
});
