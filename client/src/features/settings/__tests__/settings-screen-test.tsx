import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import { AuthProvider } from '@/auth/auth-provider';
import { tokenStore } from '@/auth/token-store';
import { clearServerError } from '@/components/server-error';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/auth/token-store', () => ({ tokenStore: { get: jest.fn(async () => null), set: jest.fn(async () => {}) } }));

function store() {
  return { get: jest.fn(async () => null), set: jest.fn<Promise<void>, [string, string]>(async () => {}), delete: jest.fn(async () => {}) };
}

async function setup() {
  const api = new MockApiClient();
  await api.signup({ display_name: 'Priya Raman', email: 'priya@example.com', password: 'test-password' });
  const preferences = store();
  const screen = await render(<ApiProvider client={api}><AuthProvider><PreferencesProvider store={preferences}>
    <SettingsScreen />
  </PreferencesProvider></AuthProvider></ApiProvider>);
  return { api, preferences, screen };
}

beforeEach(() => { jest.clearAllMocks(); clearServerError(); });

test('loads the profile, saves each preference and opens the server address', async () => {
  const { screen, preferences } = await setup();
  expect(await screen.findByText('Priya Raman')).toBeTruthy();
  expect(screen.getByText('priya@example.com')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.row.units'));
  await fireEvent.press(screen.getByTestId('settings.choice.units.metric'));
  expect(await screen.findByLabelText('Units: Metric (kg, g)')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.row.storage'));
  await fireEvent.press(screen.getByTestId('settings.choice.storage.pantry'));
  expect(await screen.findByLabelText('Default storage: Pantry')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.row.currency'));
  await fireEvent.changeText(screen.getByTestId('settings.currency.input'), 'eur');
  await fireEvent.press(screen.getByTestId('settings.currency.save'));
  expect(await screen.findByLabelText('Currency: EUR')).toBeTruthy();
  expect(JSON.parse(preferences.set.mock.calls.at(-1)![1])).toMatchObject({ units: 'metric', defaultStorage: 'pantry', currency: 'EUR' });
  await fireEvent.press(screen.getByTestId('settings.row.server'));
  expect(router.push).toHaveBeenCalledWith('/debug');
});

test('shows profile loading and retries a failed me call', async () => {
  const api = new MockApiClient();
  const me = jest.spyOn(api, 'me').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Server unavailable'));
  await api.signup({ display_name: 'Priya Raman', email: 'priya@example.com', password: 'test-password' });
  const screen = await render(<ApiProvider client={api}><AuthProvider><PreferencesProvider store={store()}><SettingsScreen /></PreferencesProvider></AuthProvider></ApiProvider>);
  expect(await screen.findByText('Server unavailable')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.profile.error.retry'));
  expect(await screen.findByText('Priya Raman')).toBeTruthy();
  expect(me).toHaveBeenCalledTimes(2);
});

test('retries a preference write without changing the selected value', async () => {
  const { screen, preferences } = await setup();
  await screen.findByText('Priya Raman');
  preferences.set.mockRejectedValueOnce(new Error('Device storage unavailable'));
  await fireEvent.press(screen.getByTestId('settings.row.units'));
  await fireEvent.press(screen.getByTestId('settings.choice.units.metric'));
  expect(await screen.findByText('Device storage unavailable')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('settings.action.error.retry'));
  await waitFor(() => expect(screen.queryByTestId('settings.action.error')).toBeNull());
  expect(screen.getByLabelText('Units: Metric (kg, g)')).toBeTruthy();
});

test('rejects an incomplete currency code', async () => {
  const { screen, preferences } = await setup();
  await screen.findByText('Priya Raman');
  await fireEvent.press(screen.getByTestId('settings.row.currency'));
  await fireEvent.changeText(screen.getByTestId('settings.currency.input'), 'US');
  await fireEvent.press(screen.getByTestId('settings.currency.save'));
  expect(screen.getByText('Enter a three-letter currency code.')).toBeTruthy();
  expect(preferences.set).not.toHaveBeenCalled();
});

test('requires confirmation, allows cancellation, then deletes and returns to Landing', async () => {
  const { screen, api } = await setup();
  const remove = jest.spyOn(api, 'deleteMe');
  await screen.findByText('Priya Raman');
  await fireEvent.press(screen.getByTestId('settings.row.delete'));
  expect(screen.getByTestId('settings.delete.modal')).toHaveProp('animationType', 'fade');
  expect(remove).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('settings.delete.cancel'));
  expect(remove).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('settings.row.delete'));
  await fireEvent.press(screen.getByTestId('settings.delete.confirm'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(remove).toHaveBeenCalledTimes(1);
  await expect(api.me()).rejects.toMatchObject({ status: 401 });
});

test('keeps the confirmation open after deletion fails and retries deletion', async () => {
  const { screen, api } = await setup();
  const remove = jest.spyOn(api, 'deleteMe').mockRejectedValueOnce(new ApiError(500, 'internal_error', 'Could not delete account'));
  await screen.findByText('Priya Raman');
  await fireEvent.press(screen.getByTestId('settings.row.delete'));
  await fireEvent.press(screen.getByTestId('settings.delete.confirm'));
  expect(await screen.findByText('Could not delete account')).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('settings.action.error.retry'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(remove).toHaveBeenCalledTimes(2);
});

test('signs out without deleting the account', async () => {
  const { screen, api } = await setup();
  const remove = jest.spyOn(api, 'deleteMe');
  await screen.findByText('Priya Raman');
  await fireEvent.press(screen.getByTestId('settings.row.signout'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(remove).not.toHaveBeenCalled();
});

test('a sign-out failure after deletion retries local cleanup without deleting twice', async () => {
  const { screen, api } = await setup();
  const remove = jest.spyOn(api, 'deleteMe');
  await screen.findByText('Priya Raman');
  jest.mocked(tokenStore.set).mockRejectedValueOnce(new Error('Couldn’t clear saved sign-in'));
  await fireEvent.press(screen.getByTestId('settings.row.delete'));
  await fireEvent.press(screen.getByTestId('settings.delete.confirm'));
  expect(await screen.findByText('Couldn’t clear saved sign-in')).toBeTruthy();
  expect(screen.getByTestId('settings.delete.cancel')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('settings.action.error.retry'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  expect(remove).toHaveBeenCalledTimes(1);
});
