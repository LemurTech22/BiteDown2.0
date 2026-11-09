import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient } from '@/api';
import { GlobalBanners } from '@/components/global-banners';
import { clearServerError, reportServerError, SectionError, useServerErrorReporter } from '@/components/server-error';
import { AppButton } from '@/components/ui/app-button';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

beforeEach(() => { clearServerError(); jest.clearAllMocks(); });
afterEach(() => clearServerError());

test.each([0, 500, 502, 503, 599])('reports API status %s', (status) => {
  expect(reportServerError(new ApiError(status, 'unavailable', 'Unavailable'))).toBe(true);
});

test.each([400, 401, 403, 404, 409, 429, 600])('does not report API status %s', (status) => {
  expect(reportServerError(new ApiError(status, 'client_error', 'Request failed'))).toBe(false);
});

test('reports raw network failures and timeouts, excludes programming errors', () => {
  expect(reportServerError(new TypeError('Network request failed'))).toBe(true);
  expect(reportServerError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(true);
  expect(reportServerError(new TypeError('Cannot read properties of undefined'))).toBe(false);
  expect(reportServerError(new Error('Unexpected state'))).toBe(false);
  expect(reportServerError(null)).toBe(false);
});

test('a screen reports a failure; health retry clears the global banner', async () => {
  const api = new MockApiClient();
  const health = jest.spyOn(api, 'health');
  function Screen() {
    const report = useServerErrorReporter();
    return <AppButton label="Report" testID="test.report.failure" onPress={() => report(new ApiError(503, 'unavailable', 'Unavailable'))} />;
  }
  const screen = await render(<ApiProvider client={api}><GlobalBanners /><Screen /></ApiProvider>);
  expect(screen.queryByTestId('serverError.banner.container')).toBeNull();
  await fireEvent.press(screen.getByTestId('test.report.failure'));
  expect(screen.getByText("Can't reach BiteDown")).toBeTruthy();
  await fireEvent.press(screen.getByTestId('serverError.banner.address'));
  expect(router.push).toHaveBeenCalledWith('/debug');
  await fireEvent.press(screen.getByTestId('serverError.banner.retry'));
  await waitFor(() => expect(screen.queryByTestId('serverError.banner.container')).toBeNull());
  expect(health).toHaveBeenCalledTimes(1);
});

test('a failed health retry leaves the non-modal banner and supports another retry', async () => {
  const api = new MockApiClient();
  const health = jest.spyOn(api, 'health').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Unavailable'));
  reportServerError(new ApiError(0, 'upstream_unavailable', 'Offline'));
  const screen = await render(<ApiProvider client={api}><GlobalBanners /></ApiProvider>);
  await fireEvent.press(screen.getByTestId('serverError.banner.retry'));
  expect(await screen.findByText("Still can't reach BiteDown. Try again.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId('serverError.banner.retry'));
  await waitFor(() => expect(screen.queryByTestId('serverError.banner.container')).toBeNull());
  expect(health).toHaveBeenCalledTimes(2);
});

test('a stale health success cannot clear a newer server failure', async () => {
  const api = new MockApiClient();
  let finish!: (value: { status: 'ok' }) => void;
  jest.spyOn(api, 'health').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  reportServerError(new ApiError(0, 'offline', 'Offline'));
  const screen = await render(<ApiProvider client={api}><GlobalBanners /></ApiProvider>);
  await fireEvent.press(screen.getByTestId('serverError.banner.retry'));
  await act(async () => {
    reportServerError(new ApiError(500, 'internal_error', 'New failure'));
    finish({ status: 'ok' });
  });
  expect(screen.getByTestId('serverError.banner.container')).toBeTruthy();
});

test('SectionError displays the message and retries its own section', async () => {
  const retry = jest.fn();
  const screen = await render(<SectionError title="Couldn’t load recipes" message="Try loading your recipes again." testID="recipes.error.state" onRetry={retry} />);
  expect(screen.getByText('Try loading your recipes again.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('recipes.error.state.retry'));
  expect(retry).toHaveBeenCalledTimes(1);
});
