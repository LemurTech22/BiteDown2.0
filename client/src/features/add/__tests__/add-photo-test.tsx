import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import { ApiError, ApiProvider, MockApiClient, type PhotoCandidatesResponse } from '@/api';
import AddModalScreen from '@/app/add-modal';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

const picker = jest.mocked(ImagePicker);
const photo: ImagePicker.ImagePickerResult = {
  canceled: false,
  assets: [{ uri: 'file:///food.jpg', fileName: 'food.jpg', mimeType: 'image/jpeg', width: 800, height: 600 }],
};

async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'photo@example.com', password: 'photo-password', display_name: 'Contributor' });
  const screen = await render(<ApiProvider client={api}><AddModalScreen /></ApiProvider>);
  return { api, screen };
}

describe('add by photo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as ImagePicker.CameraPermissionResponse);
    picker.launchCameraAsync.mockResolvedValue(photo);
    picker.launchImageLibraryAsync.mockResolvedValue(photo);
  });

  test('camera photo shows predictions and saves edited values before closing', async () => {
    const { api, screen } = await setup();
    const fromPhoto = jest.spyOn(api, 'fromPhoto');
    const createItems = jest.spyOn(api, 'createItems');
    await fireEvent.press(screen.getByTestId('add.mode.single'));
    await fireEvent.press(screen.getByTestId('add.camera.button'));
    expect(await screen.findByDisplayValue('Mock apple')).toBeTruthy();
    expect(fromPhoto).toHaveBeenCalledWith({ uri: 'file:///food.jpg', fileName: 'food.jpg', mimeType: 'image/jpeg', mode: 'single', enrich: ['expiry'] });
    expect(screen.getByText(/Predicted expiry:/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add.name.0'), 'Green apples');
    await fireEvent.changeText(screen.getByTestId('add.quantity.0'), '2.5');
    await fireEvent.press(screen.getByTestId('add.storage0.freezer'));
    await fireEvent.changeText(screen.getByTestId('add.expiry.0'), '2027-01-15');
    await fireEvent.press(screen.getByTestId('add.save.button'));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(createItems).toHaveBeenCalledWith({ items: [expect.objectContaining({
      name: 'Green apples', quantity: 2.5, storage: 'freezer', predicted_expiry: '2027-01-15',
      expiry_source: 'user', source: 'single_photo', freshness: 'fresh', confidence: 0.95, nutrition: null,
      est_weight_kg: undefined,
    })] });
    const saved = await api.getItems();
    expect('items' in saved && saved.items[0].name).toBe('Green apples');
    expect('items' in saved && saved.items[0].est_weight_kg).toBe(0.5);
  });

  test('library photo preserves prediction source and drops unwanted candidates', async () => {
    const { api, screen } = await setup();
    const response = await api.fromPhoto({ uri: 'mock', mode: 'fridge' });
    jest.spyOn(api, 'fromPhoto').mockResolvedValue({ ...response, candidates: [...response.candidates, { ...response.candidates[0], name: 'Drop me' }] });
    const createItems = jest.spyOn(api, 'createItems');
    await fireEvent.press(screen.getByTestId('add.library.button'));
    expect(await screen.findByDisplayValue('Drop me')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.drop.1'));
    await fireEvent.press(screen.getByTestId('add.save.button'));
    await waitFor(() => expect(createItems).toHaveBeenCalledTimes(1));
    expect(createItems.mock.calls[0][0].items).toEqual([expect.objectContaining({ name: 'Mock apples', expiry_source: 'default', source: 'photo' })]);
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  test('camera denied offers Settings, retry, and a library fallback', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false } as ImagePicker.CameraPermissionResponse);
    const { screen } = await setup();
    await fireEvent.press(screen.getByTestId('add.camera.button'));
    expect(await screen.findByTestId('add.picker.error')).toBeTruthy();
    expect(screen.getByTestId('add.settings.button')).toBeTruthy();
    expect(screen.getByTestId('add.picker.retry')).toBeTruthy();
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('add.library.button'));
    expect(await screen.findByDisplayValue('Mock apples')).toBeTruthy();
  });

  test('canceling the picker stays at the chooser without analyzing', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    const { api, screen } = await setup();
    const fromPhoto = jest.spyOn(api, 'fromPhoto');
    await fireEvent.press(screen.getByTestId('add.library.button'));
    expect(screen.getByTestId('add.empty.state')).toBeTruthy();
    expect(fromPhoto).not.toHaveBeenCalled();
  });

  test('slow analysis keeps its skeleton and explanation, then permits retry on timeout', async () => {
    const { api, screen } = await setup();
    let rejectPhoto!: (reason: Error) => void;
    const fromPhoto = jest.spyOn(api, 'fromPhoto').mockImplementationOnce(() => new Promise((_, reject) => { rejectPhoto = reject; }));
    await fireEvent.press(screen.getByTestId('add.library.button'));
    expect(await screen.findByTestId('add.loading.skeleton')).toBeTruthy();
    expect(screen.getByText(/75 seconds/)).toBeTruthy();
    await act(() => rejectPhoto(new ApiError(0, 'timeout', 'Photo analysis timed out.')));
    expect(await screen.findByText('Photo analysis timed out.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.analysis.retry'));
    expect(await screen.findByDisplayValue('Mock apples')).toBeTruthy();
    expect(fromPhoto).toHaveBeenCalledTimes(2);
  });

  test('an empty detection and dropping the last item both offer another photo', async () => {
    const { api, screen } = await setup();
    jest.spyOn(api, 'fromPhoto').mockResolvedValueOnce({ candidates: [], source: 'gemini' });
    await fireEvent.press(screen.getByTestId('add.library.button'));
    expect(await screen.findByTestId('add.review.empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.empty.retry'));
    await fireEvent.press(screen.getByTestId('add.camera.button'));
    expect(await screen.findByDisplayValue('Mock apples')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.drop.0'));
    expect(screen.getByTestId('add.review.empty')).toBeTruthy();
    expect(screen.queryByTestId('add.save.button')).toBeNull();
  });

  test('validates fields and retains edits when save fails and is retried', async () => {
    const { api, screen } = await setup();
    const createItems = jest.spyOn(api, 'createItems').mockRejectedValueOnce(new ApiError(503, 'unavailable', 'Please try again.'));
    await fireEvent.press(screen.getByTestId('add.library.button'));
    await screen.findByDisplayValue('Mock apples');
    await fireEvent.changeText(screen.getByTestId('add.name.0'), '');
    await fireEvent.press(screen.getByTestId('add.save.button'));
    expect(createItems).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('add.name.0'), 'Edited apples');
    await fireEvent.changeText(screen.getByTestId('add.quantity.0'), '0');
    expect(screen.getByText('Enter a quantity greater than zero.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add.quantity.0'), '2');
    await fireEvent.changeText(screen.getByTestId('add.expiry.0'), '2027-02-30');
    expect(screen.getByText('Enter a valid expiry date (YYYY-MM-DD).')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add.expiry.0'), '2027-02-28');
    await fireEvent.press(screen.getByTestId('add.save.button'));
    expect(await screen.findByTestId('add.save.error')).toBeTruthy();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Edited apples')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.save.retry'));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(createItems).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  });

  test('ignores an analysis response after canceling', async () => {
    const { api, screen } = await setup();
    let finish!: (value: PhotoCandidatesResponse) => void;
    jest.spyOn(api, 'fromPhoto').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await fireEvent.press(screen.getByTestId('add.library.button'));
    await screen.findByTestId('add.loading.skeleton');
    await fireEvent.press(screen.getByTestId('add.reset.button'));
    await act(() => finish({ candidates: [], source: 'gemini' }));
    expect(screen.getByTestId('add.empty.state')).toBeTruthy();
    expect(screen.queryByTestId('add.review.empty')).toBeNull();
  });

  test('does not navigate back again if a save finishes after closing the modal', async () => {
    const { api, screen } = await setup();
    let finish!: () => void;
    jest.spyOn(api, 'createItems').mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ items: [] });
    }));
    await fireEvent.press(screen.getByTestId('add.library.button'));
    await screen.findByDisplayValue('Mock apples');
    await fireEvent.press(screen.getByTestId('add.save.button'));
    await fireEvent.press(screen.getByTestId('add.close.button'));
    await screen.unmount();
    await act(() => finish());
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
