import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { ApiProvider, MockApiClient } from '@/api';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { AuthScreen } from '@/auth/auth-screen';
import { tokenStore } from '@/auth/token-store';

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/auth/token-store', () => ({
  tokenStore: {
    get: jest.fn(),
    set: jest.fn(),
  },
}));

const mockedTokenStore = jest.mocked(tokenStore);
const mockReplace = jest.mocked(router.replace);

async function renderAuth(api: MockApiClient, mode: 'login' | 'signup', next?: string) {
  return render(
    <ApiProvider client={api}>
      <AuthProvider>
        <AuthScreen mode={mode} next={next} />
      </AuthProvider>
    </ApiProvider>,
  );
}

describe('email authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTokenStore.get.mockResolvedValue(null);
    mockedTokenStore.set.mockResolvedValue(undefined);
  });

  test('signs up with valid details and blocks a short password', async () => {
    const api = new MockApiClient();
    const screen = await renderAuth(api, 'signup');

    await fireEvent.changeText(screen.getByTestId('signup.name.input'), 'Demo User');
    await fireEvent.changeText(screen.getByTestId('signup.email.input'), 'demo@example.com');
    await fireEvent.changeText(screen.getByTestId('signup.password.input'), 'short');
    await fireEvent.press(screen.getByTestId('signup.submit.button'));

    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('signup.password.input'), 'password-for-demo');
    await fireEvent.press(screen.getByTestId('signup.submit.button'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'));
    expect((await api.me()).user.email).toBe('demo@example.com');
  });

  test('shows invalid credentials and then logs in', async () => {
    const api = new MockApiClient();
    await api.signup({ email: 'demo@example.com', password: 'password-for-demo', display_name: 'Demo User' });
    const screen = await renderAuth(api, 'login');

    await fireEvent.changeText(screen.getByTestId('login.email.input'), 'demo@example.com');
    await fireEvent.changeText(screen.getByTestId('login.password.input'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('login.submit.button'));

    expect(await screen.findByText('That email and password don’t match. Try again.')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('login.password.input'), 'password-for-demo');
    await fireEvent.press(screen.getByTestId('login.submit.button'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'));
  });

  test('restores a saved session through GET auth me', async () => {
    const api = new MockApiClient();
    await api.signup({ email: 'demo@example.com', password: 'password-for-demo', display_name: 'Demo User' });
    const me = jest.spyOn(api, 'me');
    mockedTokenStore.get.mockResolvedValue('saved-demo-token');

    function Probe() {
      const { user } = useAuth();
      return <Text>{user?.email ?? 'signed out'}</Text>;
    }

    const screen = await render(
      <ApiProvider client={api}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </ApiProvider>,
    );

    expect(await screen.findByText('demo@example.com')).toBeTruthy();
    expect(me).toHaveBeenCalledTimes(1);
  });

  describe.each(['login', 'signup'] as const)('%s next target', (mode) => {
    test.each([
      ['/social/scan?code=ABC', '/social/scan?code=ABC'],
      ['/social/connect?invite=XYZ', '/social/connect?invite=XYZ'],
      ['https://evil.example', '/home'],
      ['//evil', '/home'],
      ['/social/../home', '/home'],
    ])('after successful auth, handles %s', async (next, destination) => {
      const api = new MockApiClient();
      if (mode === 'login') {
        await api.signup({ email: 'demo@example.com', password: 'password-for-demo', display_name: 'Demo User' });
      }
      const screen = await renderAuth(api, mode, next);
      if (mode === 'signup') await fireEvent.changeText(screen.getByTestId('signup.name.input'), 'Demo User');
      await fireEvent.changeText(screen.getByTestId(`${mode}.email.input`), 'demo@example.com');
      await fireEvent.changeText(screen.getByTestId(`${mode}.password.input`), 'password-for-demo');
      await fireEvent.press(screen.getByTestId(`${mode}.submit.button`));
      await waitFor(() => expect(mockReplace).toHaveBeenLastCalledWith(destination));
    });

    test('carries next when switching auth screens', async () => {
      const next = '/social/scan?code=ABC';
      const screen = await renderAuth(new MockApiClient(), mode, next);
      const destination = mode === 'login' ? 'signup' : 'login';
      await fireEvent.press(screen.getByTestId(`${mode}.${destination}.link`));
      expect(mockReplace).toHaveBeenLastCalledWith({ pathname: `/${destination}`, params: { next } });
    });
  });
});
