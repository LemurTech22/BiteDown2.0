import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { AppState, Linking, Share } from 'react-native';

import { ApiError, ApiProvider, MockApiClient, type FriendsResponse } from '@/api';
import { clearServerError, getServerErrorRevision } from '@/components/server-error/store';
import { ConnectScreen } from '@/features/connect/connect-screen';
import { FriendCodeCard } from '@/features/connect/friend-code-card';
import { GroupDetailScreen } from '@/features/connect/group-detail-screen';
import { ScanScreen } from '@/features/connect/scan-screen';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
    useLocalSearchParams: jest.fn(() => ({ id: 'group-flat' })),
  };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: ({ value }: { value: string }) => React.createElement(View, { testID: 'qr.payload', accessibilityLabel: value }) };
});
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    CameraView: React.forwardRef(function MockCamera(props: object, ref: React.ForwardedRef<unknown>) {
      React.useImperativeHandle(ref, () => ({ pausePreview: () => Promise.resolve(), resumePreview: () => Promise.resolve() }));
      return React.createElement(View, props);
    }),
    useCameraPermissions: jest.fn(),
  };
});

const granted = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as ReturnType<typeof useCameraPermissions>[0];
const denied = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' } as ReturnType<typeof useCameraPermissions>[0];
const requestPermission = jest.fn();
const getPermission = jest.fn();

async function client() {
  const api = new MockApiClient();
  await api.signup({ email: 'connect@example.com', password: 'password-test', display_name: 'Contributor' });
  return api;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearServerError();
  AppState.currentState = 'active';
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'group-flat' });
  jest.mocked(useCameraPermissions).mockReturnValue([granted, requestPermission, getPermission]);
  getPermission.mockResolvedValue(granted);
  requestPermission.mockResolvedValue(granted);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('Friends and groups', () => {
  test('prefills an invite once and waits for Join, preserving edits on rerender', async () => {
    const api = await client();
    const join = jest.spyOn(api, 'joinGroup');
    jest.mocked(useLocalSearchParams).mockReturnValue({ invite: 'F4AT8BCD' });
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    expect(await screen.findByTestId('connect.join.input')).toHaveProp('value', 'F4AT8BCD');
    expect(join).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('connect.join.input'), 'EditedCode');
    jest.mocked(useLocalSearchParams).mockReturnValue({ invite: 'AnotherCode' });
    await screen.rerender(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    expect(screen.getByTestId('connect.join.input')).toHaveProp('value', 'EditedCode');
    expect(join).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('connect.join.submit'));
    expect(join).toHaveBeenCalledWith({ invite_code: 'EditedCode' });
  });

  test('reports server load failures, keeps inline errors, and leaves validation errors local', async () => {
    const api = await client();
    jest.spyOn(api, 'getFriends').mockRejectedValueOnce(new ApiError(503, 'offline', 'Please reconnect.'));
    const revision = getServerErrorRevision();
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    expect(await screen.findByText('Please reconnect.')).toBeTruthy();
    expect(getServerErrorRevision()).toBe(revision + 1);
    await fireEvent.press(screen.getByTestId('connect.error.retry'));
    await screen.findByTestId('connect.email.toggle');
    await fireEvent.press(screen.getByTestId('connect.email.toggle'));
    await fireEvent.changeText(screen.getByTestId('connect.email.input'), 'missing@example.com');
    await fireEvent.press(screen.getByTestId('connect.email.send'));
    expect(await screen.findByText('No BiteDown account uses that email.')).toBeTruthy();
    expect(getServerErrorRevision()).toBe(revision + 1);
  });

  test('accepts an incoming request and moves it into Friends', async () => {
    const api = await client();
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.accept.friend-dana');
    await fireEvent.press(screen.getByTestId('connect.accept.friend-dana'));
    expect(await screen.findByTestId('connect.friend.friend-dana')).toBeTruthy();
    expect(screen.queryByTestId('connect.incoming.friend-dana')).toBeNull();
    expect((await api.getFriends()).incoming).toHaveLength(0);
  });

  test('declines incoming requests', async () => {
    const api = await client();
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.decline.friend-dana');
    await fireEvent.press(screen.getByTestId('connect.decline.friend-dana'));
    await waitFor(() => expect(screen.queryByTestId('connect.incoming.friend-dana')).toBeNull());
    expect((await api.getFriends()).friends).toHaveLength(2);
  });

  test('shows the exact email error, sends a request, and withdraws it', async () => {
    const api = await client();
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.email.toggle');
    await fireEvent.press(screen.getByTestId('connect.email.toggle'));
    expect(screen.getByTestId('connect.email.toggle')).toHaveProp('accessibilityState', { expanded: true });
    await fireEvent.changeText(screen.getByTestId('connect.email.input'), 'missing@example.com');
    await fireEvent.press(screen.getByTestId('connect.email.send'));
    expect(await screen.findByText('No BiteDown account uses that email.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('connect.email.input'), 'eli@example.com');
    await fireEvent.press(screen.getByTestId('connect.email.send'));
    expect(await screen.findByText('Sent · 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('connect.withdraw.friend-eli'));
    await waitFor(() => expect(screen.queryByText('Sent · 1')).toBeNull());
    expect((await api.getFriends()).outgoing).toHaveLength(0);
  });

  test('retries a failed request action', async () => {
    const api = await client();
    const accept = jest.spyOn(api, 'acceptFriend').mockRejectedValueOnce(new ApiError(503, 'offline', 'Please reconnect.'));
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.accept.friend-dana');
    await fireEvent.press(screen.getByTestId('connect.accept.friend-dana'));
    expect(await screen.findByText('Please reconnect.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('connect.action.retry'));
    expect(await screen.findByTestId('connect.friend.friend-dana')).toBeTruthy();
    expect(accept).toHaveBeenCalledTimes(2);
  });

  test('creates a group and opens its detail route', async () => {
    const api = await client();
    const create = jest.spyOn(api, 'createGroup');
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.create.toggle');
    await fireEvent.press(screen.getByTestId('connect.create.toggle'));
    await fireEvent.changeText(screen.getByTestId('connect.create.input'), 'Kitchen crew');
    await fireEvent.press(screen.getByTestId('connect.create.submit'));
    expect(await screen.findByText('Kitchen crew')).toBeTruthy();
    const { group } = await create.mock.results[0].value;
    await fireEvent.press(screen.getByTestId(`connect.group.${group.id}`));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/social/group/[id]', params: { id: group.id } });
  });

  test('joins a group by its invite code and shows join errors inline', async () => {
    const api = await client();
    await api.signup({ email: 'host@example.com', password: 'password-test', display_name: 'Host' });
    const { group } = await api.createGroup({ name: 'Neighbours' });
    await api.login({ email: 'connect@example.com', password: 'password-test' });
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    await screen.findByTestId('connect.join.toggle');
    await fireEvent.press(screen.getByTestId('connect.join.toggle'));
    await fireEvent.changeText(screen.getByTestId('connect.join.input'), 'wrong');
    await fireEvent.press(screen.getByTestId('connect.join.submit'));
    expect(await screen.findByText('No group with that invite code.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('connect.join.input'), group.invite_code.toLowerCase());
    await fireEvent.press(screen.getByTestId('connect.join.submit'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/social/group/[id]', params: { id: group.id } }));
    expect((await api.getGroups()).groups.some((entry) => entry.id === group.id)).toBe(true);
  });

  test('shows loading, error, retry and empty list states', async () => {
    const api = await client();
    let reject!: (error: Error) => void;
    jest.spyOn(api, 'getFriends').mockImplementationOnce(() => new Promise<FriendsResponse>((_, fail) => { reject = fail; }))
      .mockResolvedValue({ friends: [], incoming: [], outgoing: [] });
    jest.spyOn(api, 'getGroups').mockResolvedValue({ groups: [] });
    const screen = await render(<ApiProvider client={api}><ConnectScreen /></ApiProvider>);
    expect(screen.getByTestId('connect.loading.skeleton')).toBeTruthy();
    await act(() => reject(new Error('Offline')));
    expect(await screen.findByTestId('connect.error.state')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('connect.error.retry'));
    expect(await screen.findByTestId('connect.friends.empty')).toBeTruthy();
    expect(screen.getByTestId('connect.groups.empty')).toBeTruthy();
  });
});

describe('My friend code', () => {
  test('encodes the friend link, copies it and opens Scan', async () => {
    const api = await client();
    const code = await api.getFriendCode();
    const screen = await render(<ApiProvider client={api}><FriendCodeCard /></ApiProvider>);
    await screen.findByTestId('connect.code.qr');
    expect(screen.getByTestId('qr.payload', { includeHiddenElements: true })).toHaveProp('accessibilityLabel', code.url);
    expect(screen.queryByText(code.code)).toBeNull();
    await fireEvent.press(screen.getByTestId('connect.code.copy'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(code.url));
    await fireEvent.press(screen.getByTestId('connect.code.scan'));
    expect(router.push).toHaveBeenCalledWith('/social/scan');
  });

  test('counts down as text and refetches at expiry', async () => {
    jest.useFakeTimers();
    const api = await client();
    const first = await api.getFriendCode();
    const getCode = jest.spyOn(api, 'getFriendCode').mockResolvedValueOnce({ ...first, expires_at: new Date(Date.now() + 10_000).toISOString() });
    const screen = await render(<ApiProvider client={api}><FriendCodeCard /></ApiProvider>);
    await screen.findByText('New code in 0:10');
    await act(async () => jest.advanceTimersByTime(10_000));
    await waitFor(() => expect(getCode).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('connect.code.countdown')).toHaveTextContent('New code in 9:50');
  });

  test('refreshes on foreground and retries a failed refresh', async () => {
    const api = await client();
    let foreground!: (state: 'active') => void;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      foreground = listener;
      return { remove: jest.fn() };
    });
    const getCode = jest.spyOn(api, 'getFriendCode').mockRejectedValueOnce(new Error('Offline'));
    const screen = await render(<ApiProvider client={api}><FriendCodeCard /></ApiProvider>);
    await screen.findByTestId('connect.code.retry');
    await fireEvent.press(screen.getByTestId('connect.code.retry'));
    expect(await screen.findByTestId('connect.code.qr')).toBeTruthy();
    await act(() => foreground('active'));
    await waitFor(() => expect(getCode).toHaveBeenCalledTimes(3));
  });
});

describe('Scan a friend’s code and Friend added', () => {
  test('ignores other QRs, debounces recognised codes and shows the success sheet', async () => {
    const api = await client();
    const add = jest.spyOn(api, 'addFriend');
    const screen = await render(<ApiProvider client={api}><ScanScreen /></ApiProvider>);
    const camera = screen.getByTestId('friendScan.camera.preview');
    await fireEvent(camera, 'barcodeScanned', { data: 'https://example.com' });
    await fireEvent(camera, 'barcodeScanned', { data: 'bitedown://group/F4AT8BCD' });
    expect(add).not.toHaveBeenCalled();
    await fireEvent(camera, 'barcodeScanned', { data: 'bitedown://friend/DanaDemoCode12345' });
    await fireEvent(camera, 'barcodeScanned', { data: 'bitedown://friend/DanaDemoCode12345' });
    expect(await screen.findByText("You're now friends with Dana Whitfield")).toBeTruthy();
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('friendAdded.sheet.modal')).toHaveProp('animationType', 'fade');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    await fireEvent.press(screen.getByTestId('friendAdded.done.button'));
    expect(router.dismissTo).toHaveBeenCalledWith('/social/connect');
  });

  test('accepts a raw code, identifies an existing friend and scans another', async () => {
    const api = await client();
    const screen = await render(<ApiProvider client={api}><ScanScreen /></ApiProvider>);
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'AnaDemoCode123456');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByText("You're already friends with Ana Rivera")).toBeTruthy();
    await fireEvent.press(screen.getByTestId('friendAdded.another.button'));
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'bitedown://friend/DanaDemoCode12345');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByText("You're now friends with Dana Whitfield")).toBeTruthy();
  });

  test('shows own-code and generic expiry errors as alerts, then retries', async () => {
    const api = await client();
    const { code } = await api.getFriendCode();
    const screen = await render(<ApiProvider client={api}><ScanScreen /></ApiProvider>);
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), code);
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByText("That's your code. Scan a friend's instead.")).toBeTruthy();
    expect(screen.getByTestId('friendScan.code.input.error')).toHaveProp('accessibilityRole', 'alert');
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'expired');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByText('That code expired. Ask them to show it again.')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'DanaDemoCode12345');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByTestId('friendAdded.success.title')).toBeTruthy();
  });

  test('keeps manual entry with denied camera permission and opens Settings', async () => {
    const api = await client();
    jest.mocked(useCameraPermissions).mockReturnValue([denied, requestPermission, getPermission]);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const screen = await render(<ApiProvider client={api}><ScanScreen /></ApiProvider>);
    expect(screen.getByText('Camera access is off')).toBeTruthy();
    expect(screen.queryByTestId('friendScan.camera.preview')).toBeNull();
    await fireEvent.press(screen.getByTestId('friendScan.camera.settings'));
    expect(settings).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'DanaDemoCode12345');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(await screen.findByTestId('friendAdded.success.title')).toBeTruthy();
  });

  test('retries a network error and disables submission while pending', async () => {
    const api = await client();
    let reject!: (reason: Error) => void;
    const add = jest.spyOn(api, 'addFriend').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const screen = await render(<ApiProvider client={api}><ScanScreen /></ApiProvider>);
    await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'DanaDemoCode12345');
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(screen.getByTestId('friendScan.add.loading')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    expect(add).toHaveBeenCalledTimes(1);
    await act(() => reject(new ApiError(503, 'unavailable', 'Offline')));
    await screen.findByText('That code expired. Ask them to show it again.');
    await fireEvent.press(screen.getByTestId('friendScan.error.retry'));
    expect(await screen.findByTestId('friendAdded.success.title')).toBeTruthy();
    expect(add).toHaveBeenCalledTimes(2);
  });
});

describe('Group detail', () => {
  test('loads the pantry, opens Add, shares the invite and toggles its QR', async () => {
    const api = await client();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    const screen = await render(<ApiProvider client={api}><GroupDetailScreen /></ApiProvider>);
    await screen.findByText('Flat 4B');
    expect(screen.queryByTestId('groupDetail.invite.qr')).toBeNull();
    expect(screen.getByTestId('groupDetail.qr.toggle')).toHaveProp('accessibilityState', { expanded: false });
    await fireEvent.press(screen.getByTestId('groupDetail.qr.toggle'));
    expect(screen.getByTestId('groupDetail.invite.qr')).toHaveProp('accessibilityLabel', 'Invite code F4AT-8BCD, QR');
    expect(screen.getByTestId('qr.payload', { includeHiddenElements: true })).toHaveProp('accessibilityLabel', 'bitedown://group/F4AT8BCD');
    expect(screen.queryByTestId('connect.code.countdown')).toBeNull();
    await fireEvent.press(screen.getByTestId('groupDetail.qr.toggle'));
    expect(screen.queryByTestId('groupDetail.invite.qr')).toBeNull();
    await fireEvent.press(screen.getByTestId('groupDetail.invite.share'));
    expect(share).toHaveBeenCalledWith({ message: 'Join Flat 4B on BiteDown: bitedown://group/F4AT8BCD' });
    await fireEvent.press(screen.getByTestId('groupDetail.pantry.add'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/add-text', params: { group_id: 'group-flat' } });
  });

  test('requires confirmation to leave, permits cancel and retries errors', async () => {
    const api = await client();
    const leave = jest.spyOn(api, 'leaveGroup').mockRejectedValueOnce(new ApiError(503, 'offline', 'Couldn’t leave.'));
    const screen = await render(<ApiProvider client={api}><GroupDetailScreen /></ApiProvider>);
    await screen.findByText('Flat 4B');
    await fireEvent.press(screen.getByTestId('groupDetail.leave.button'));
    expect(leave).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('groupDetail.leave.cancel'));
    expect(screen.queryByTestId('groupDetail.leave.confirmation')).toBeNull();
    await fireEvent.press(screen.getByTestId('groupDetail.leave.button'));
    await fireEvent.press(screen.getByTestId('groupDetail.leave.confirm'));
    expect(await screen.findByText('Couldn’t leave.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('groupDetail.action.retry'));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/social/connect'));
    expect(leave).toHaveBeenCalledTimes(2);
    expect((await api.getGroups()).groups).toHaveLength(0);
  });

  test('shows a load error with retry and an empty pantry', async () => {
    const api = await client();
    const { group } = await api.createGroup({ name: 'Empty kitchen' });
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: group.id });
    jest.spyOn(api, 'getGroupPantry').mockRejectedValueOnce(new ApiError(503, 'offline', 'Offline'));
    const screen = await render(<ApiProvider client={api}><GroupDetailScreen /></ApiProvider>);
    expect(await screen.findByTestId('groupDetail.error.state')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('groupDetail.error.retry'));
    expect(await screen.findByTestId('groupDetail.pantry.empty')).toBeTruthy();
  });

  test('filters requests to the group and retries request errors', async () => {
    const api = await client();
    jest.spyOn(api, 'getRequests').mockRejectedValueOnce(new ApiError(503, 'offline', 'Offline'));
    const screen = await render(<ApiProvider client={api}><GroupDetailScreen /></ApiProvider>);
    await screen.findByText('Flat 4B');
    await fireEvent.press(screen.getByTestId('groupDetail.tab.requests'));
    expect(await screen.findByTestId('groupDetail.requests.error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('groupDetail.requests.retry'));
    const { requests } = await api.getRequests();
    for (const request of requests) {
      if (request.audiences.groups.some((group) => group.id === 'group-flat')) {
        expect(await screen.findByText(request.text)).toBeTruthy();
      } else expect(screen.queryByText(request.text)).toBeNull();
    }
  });
});


