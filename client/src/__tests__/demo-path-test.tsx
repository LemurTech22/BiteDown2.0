import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { cleanup, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider, MockApiClient } from '@/api';
import TabLayout from '@/app/(tabs)/_layout';
import AddTabRoute from '@/app/(tabs)/add';
import FridgeRoute from '@/app/(tabs)/fridge';
import HomeRoute from '@/app/(tabs)/home';
import ImpactRoute from '@/app/(tabs)/impact';
import SocialRoute from '@/app/(tabs)/social';
import AddModalRoute from '@/app/add-modal';
import LoginRoute from '@/app/login';
import { AuthProvider } from '@/auth/auth-provider';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/auth/token-store', () => ({
  tokenStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}) },
}));
jest.mock('@/storage/key-value-store', () => ({
  deviceStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) },
}));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

describe('merge-gate demo path', () => {
  afterEach(async () => {
    await cleanup();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('login → photo and expiry → Fridge → used → Impact; Undo restores food and impact', async () => {
    const api = new MockApiClient();
    const credentials = { email: 'demo-path@example.com', password: 'demo-path-password' };
    await api.signup({ ...credentials, display_name: 'Demo' });
    const login = jest.spyOn(api, 'login');
    const analyze = jest.spyOn(api, 'fromPhoto');
    const create = jest.spyOn(api, 'createItems');
    const remove = jest.spyOn(api, 'removeItem');
    const restore = jest.spyOn(api, 'restoreItem');
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is disabled in the demo test.'));
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
      granted: true, status: 'granted' as ImagePicker.PermissionStatus, canAskAgain: true, expires: 'never',
    });
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///demo-food.jpg', fileName: 'demo-food.jpg', mimeType: 'image/jpeg', width: 800, height: 600 }],
    });

    // Inject one client at the root; all route components and the tab shell are real.
    function DemoLayout() {
      return <SafeAreaProvider>
        <ApiProvider client={api}>
          <PreferencesProvider>
          <AuthProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="add-modal" options={{ presentation: 'modal' }} />
            </Stack>
          </AuthProvider>
          </PreferencesProvider>
        </ApiProvider>
      </SafeAreaProvider>;
    }

    const view = await renderRouter({
      _layout: DemoLayout,
      login: LoginRoute,
      '(tabs)/_layout': TabLayout,
      '(tabs)/home': HomeRoute,
      '(tabs)/fridge': FridgeRoute,
      '(tabs)/add': AddTabRoute,
      '(tabs)/social': SocialRoute,
      '(tabs)/impact': ImpactRoute,
      'add-modal': AddModalRoute,
    }, { initialUrl: '/login' });

    await fireEvent.changeText(screen.getByTestId('login.email.input'), credentials.email);
    await fireEvent.changeText(screen.getByTestId('login.password.input'), credentials.password);
    await fireEvent.press(screen.getByTestId('login.submit.button'));
    await waitFor(() => expect(view.getPathname()).toBe('/home'));
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(credentials);
    expect(await screen.findByText('Hi, Demo')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tabs.impact.button'));
    const earlierValue = (await screen.findByTestId('impact.saved.value')).props.children;
    expect(earlierValue).toBe('0.0 lb');
    const earlierImpact = await api.getImpact('month');

    await fireEvent.press(screen.getByTestId('tabs.fridge.button'));
    await fireEvent.press(await screen.findByTestId('fridge.empty.add'));
    await waitFor(() => expect(view.getPathname()).toBe('/add-modal'));
    await fireEvent.press(screen.getByTestId('add.camera.button'));
    expect(await screen.findByDisplayValue('Mock apples')).toBeTruthy();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith({
      uri: 'file:///demo-food.jpg', fileName: 'demo-food.jpg', mimeType: 'image/jpeg', mode: 'fridge', enrich: ['expiry'],
    });
    expect(screen.getByText(/Predicted expiry:/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add.name.0'), 'Demo apples');
    await fireEvent.press(screen.getByTestId('add.save.button'));
    await waitFor(() => expect(view.getPathname()).toBe('/fridge'));
    expect(create).toHaveBeenCalledTimes(1);
    const { items: [item] } = await create.mock.results[0].value;
    expect(item.predicted_expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(screen.getByText('Demo apples')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);

    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.thrown_out'));
    expect(screen.getByText('Why was it thrown out?')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('remove.cancel.button'));
    expect(screen.getByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(await api.getImpact('month')).toEqual(earlierImpact);

    await fireEvent.press(screen.getByTestId(`fridge.remove.${item.id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
    expect(await screen.findByTestId(`remove.undo.${item.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`fridge.item.${item.id}`)).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(item.id, { outcome: 'used' });

    await fireEvent.press(screen.getByTestId('tabs.impact.button'));
    await waitFor(() => expect(screen.getByTestId('impact.saved.value')).toHaveTextContent('7.1 oz'));
    expect(screen.getByTestId('impact.items.value')).toHaveTextContent('1');
    expect((await api.getImpact('month')).saved.kg).toBeGreaterThan(earlierImpact.saved.kg);

    await fireEvent.press(screen.getByTestId('tabs.fridge.button'));
    await fireEvent.press(await screen.findByTestId(`remove.undo.${item.id}`));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(item.id);
    expect(await screen.findByTestId(`fridge.item.${item.id}`)).toBeTruthy();
    expect(screen.getByText('Demo apples')).toBeTruthy();
    expect(screen.queryByTestId(`remove.undo.${item.id}`)).toBeNull();

    await fireEvent.press(screen.getByTestId('tabs.impact.button'));
    await waitFor(() => expect(screen.getByTestId('impact.saved.value')).toHaveTextContent(earlierValue));
    expect(await api.getImpact('month')).toEqual(earlierImpact);
    expect(fetch).not.toHaveBeenCalled();
  });
});
