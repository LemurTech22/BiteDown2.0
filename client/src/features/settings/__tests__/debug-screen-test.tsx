import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiProvider, DEFAULT_API_BASE_URL, MockApiClient, useApi } from '@/api';
import { DebugSettingsScreen } from '@/features/settings/debug-screen';
import { deviceStore } from '@/storage/key-value-store';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/storage/key-value-store', () => ({ deviceStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}), delete: jest.fn(async () => {}) } }));

const saved = jest.mocked(deviceStore.set);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(deviceStore.get).mockResolvedValue(null);
});

test('saves and normalizes the server address; resets to the default', async () => {
  const screen = await render(<ApiProvider client={new MockApiClient()}><DebugSettingsScreen /></ApiProvider>);
  await fireEvent.changeText(screen.getByTestId('settings.server.input'), 'https://demo.example.com/');
  await fireEvent.press(screen.getByTestId('settings.server.save'));
  expect(await screen.findByText('Server address saved.')).toBeTruthy();
  expect(saved).toHaveBeenCalledWith('settings.apiBaseUrl', 'https://demo.example.com');
  expect(screen.getByTestId('settings.server.input')).toHaveProp('value', 'https://demo.example.com');
  expect(screen.getByText('Custom address')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.server.reset'));
  expect(await screen.findByText('Server address reset.')).toBeTruthy();
  expect(deviceStore.delete).toHaveBeenCalledWith('settings.apiBaseUrl');
  expect(saved).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('settings.server.input')).toHaveProp('value', DEFAULT_API_BASE_URL);
  expect(screen.getByText('Default address')).toBeTruthy();
});

test('reset restores the cached server config and retries failed deletions', async () => {
  jest.mocked(deviceStore.get).mockImplementation(async (key) => {
    if (key === 'settings.apiBaseUrl') return 'https://custom.example.com';
    if (key === 'settings.remoteApiBaseUrl') return 'https://remote.example.com';
    return null;
  });
  const screen = await render(<ApiProvider client={new MockApiClient()}><DebugSettingsScreen /></ApiProvider>);
  await waitFor(() => expect(screen.getByTestId('settings.server.input')).toHaveProp('value', 'https://custom.example.com'));
  await fireEvent.changeText(screen.getByTestId('settings.server.input'), 'https://unsaved.example.com');
  jest.mocked(deviceStore.delete).mockRejectedValueOnce(new Error('Cannot reset address'));
  await fireEvent.press(screen.getByTestId('settings.server.reset'));
  expect(await screen.findByText('Cannot reset address')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('debug.error.state.retry'));
  expect(await screen.findByText('From server config')).toBeTruthy();
  expect(screen.getByTestId('settings.server.input')).toHaveProp('value', 'https://remote.example.com');
  expect(saved).not.toHaveBeenCalled();
});

test('shows invalid addresses and retries a failed write', async () => {
  const screen = await render(<ApiProvider client={new MockApiClient()}><DebugSettingsScreen /></ApiProvider>);
  await fireEvent.changeText(screen.getByTestId('settings.server.input'), 'ftp://example.com');
  await fireEvent.press(screen.getByTestId('settings.server.save'));
  expect(await screen.findByText('Server address must start with http:// or https://.')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('settings.server.input'), 'https://new.example.com');
  saved.mockRejectedValueOnce(new Error('Storage unavailable'));
  await fireEvent.press(screen.getByTestId('settings.server.save'));
  expect(await screen.findByText('Storage unavailable')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('debug.error.state.retry'));
  expect(await screen.findByText('Server address saved.')).toBeTruthy();
});

test('demo-mode persistence failures are visible and retryable', async () => {
  let initialDemoMode = false;
  function Probe() { initialDemoMode = useApi().demoMode; return null; }
  const screen = await render(<ApiProvider client={new MockApiClient()}><Probe /><DebugSettingsScreen /></ApiProvider>);
  const next = !initialDemoMode;
  saved.mockRejectedValueOnce(new Error('Couldn’t store demo mode'));
  await fireEvent(screen.getByTestId('settings.demo.switch'), 'valueChange', next);
  expect(await screen.findByText('Couldn’t store demo mode')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('debug.error.state.retry'));
  await waitFor(() => expect(screen.getByTestId('settings.demo.switch')).toHaveProp('value', next));
});
