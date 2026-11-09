import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';

import { ApiError, ApiProvider, MockApiClient, type ReceiptCandidatesResponse } from '@/api';
import { PreferencesProvider } from '@/settings/preferences';

import { AddBarcodeScreen } from '../add-barcode-screen';
import { AddMethods } from '../add-methods';
import { AddPhotoScreen } from '../add-photo-screen';
import { AddReceiptScreen } from '../add-receipt-screen';
import { AddTextScreen } from '../add-text-screen';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true) },
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { CameraView: View, useCameraPermissions: jest.fn() };
});
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

const photo: ImagePicker.ImagePickerResult = { canceled: false, assets: [{ uri: 'file:///receipt.jpg', fileName: 'receipt.jpg', mimeType: 'image/jpeg', width: 800, height: 600 }] };
const permission = { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as ImagePicker.CameraPermissionResponse;
const deniedPermission = { ...permission, granted: false, status: 'denied' } as ImagePicker.CameraPermissionResponse;
const requestPermission = jest.fn();

async function setup(element: ReactElement, currency = 'USD') {
  const api = new MockApiClient();
  await api.signup({ email: 'add@example.com', password: 'password-for-demo', display_name: 'Contributor' });
  const store = { get: async () => JSON.stringify({ currency }), set: async () => {}, delete: async () => {} };
  const screen = await render(<ApiProvider client={api}><PreferencesProvider store={store}>{element}</PreferencesProvider></ApiProvider>);
  return { api, screen };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(useCameraPermissions).mockReturnValue([permission, requestPermission, requestPermission]);
  requestPermission.mockResolvedValue(permission);
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(permission);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(photo);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(photo);
});
afterEach(() => jest.restoreAllMocks());

describe('add sheet', () => {
  test.each([['text', '/add-text'], ['voice', '/add-text?mode=voice'], ['barcode', '/add-barcode'], ['receipt', '/add-receipt']])('%s tile opens its route', async (id, route) => {
    const { screen } = await setup(<AddMethods />);
    await fireEvent.press(screen.getByTestId(`add.method.${id}`));
    expect(router.push).toHaveBeenCalledWith(route);
  });

  test('photo permission denial offers Settings and typing', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(deniedPermission);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const { screen } = await setup(<AddPhotoScreen />);
    await fireEvent.press(screen.getByTestId('add.hero.button'));
    expect(await screen.findByText('Camera access is off')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add.settings.button'));
    expect(settings).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('add.type.button'));
    expect(router.push).toHaveBeenCalledWith('/add-text');
  });
});

describe('text and keyboard dictation', () => {
  async function parse(screen: Awaited<ReturnType<typeof setup>>['screen']) {
    await fireEvent.changeText(screen.getByTestId('addText.input.text'), 'A bag of apples');
    await fireEvent.press(screen.getByTestId('addText.parse.button'));
  }

  test('parses, edits, and saves to the fridge', async () => {
    const { api, screen } = await setup(<AddTextScreen />);
    const create = jest.spyOn(api, 'createItems');
    await parse(screen);
    expect(await screen.findByText('We understood 1 item')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addText.edit.0'));
    await fireEvent.changeText(screen.getByTestId('add.name.0'), 'Green apples');
    await fireEvent.changeText(screen.getByTestId('add.quantity.0'), '2');
    await fireEvent.press(screen.getByTestId('add.storage0.pantry'));
    await fireEvent.press(screen.getByTestId('addText.save.button'));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/fridge'));
    expect(create).toHaveBeenCalledWith({ items: [expect.objectContaining({ name: 'Green apples', quantity: 2, storage: 'pantry', source: 'text' })] });
  });

  test('voice mode uses the keyboard hint and group save returns back', async () => {
    const { api, screen } = await setup(<AddTextScreen />);
    const group = await api.createGroup({ name: 'Shared kitchen' });
    jest.mocked(useLocalSearchParams).mockReturnValue({ mode: 'voice', group_id: group.group.id });
    await screen.rerender(<ApiProvider client={api}><PreferencesProvider><AddTextScreen /></PreferencesProvider></ApiProvider>);
    expect(screen.getByText('Use the microphone on your keyboard to say what you got.')).toBeTruthy();
    const create = jest.spyOn(api, 'createItems');
    await parse(screen);
    await screen.findByText('We understood 1 item');
    await fireEvent.press(screen.getByTestId('addText.save.button'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({ group_id: group.group.id, items: [expect.objectContaining({ source: 'text' })] });
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  test('parse errors retry and empty responses have an empty state', async () => {
    const { api, screen } = await setup(<AddTextScreen />);
    jest.spyOn(api, 'parseText').mockRejectedValueOnce(new Error('Parser unavailable')).mockResolvedValueOnce({ candidates: [] });
    await parse(screen);
    expect(await screen.findByText('Parser unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addText.parse.retry'));
    expect(await screen.findByTestId('addText.review.empty')).toBeTruthy();
    expect(screen.queryByTestId('addText.save.button')).toBeNull();
  });

  test('retains edits after a save error and retries once', async () => {
    const { api, screen } = await setup(<AddTextScreen />);
    const create = jest.spyOn(api, 'createItems').mockRejectedValueOnce(new Error('Save unavailable'));
    await parse(screen);
    await screen.findByText('We understood 1 item');
    await fireEvent.press(screen.getByTestId('addText.save.button'));
    expect(await screen.findByText('Save unavailable')).toBeTruthy();
    expect(router.dismissTo).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('addText.save.retry'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
  });

  test('selection controls saving and slow parsing shows a skeleton', async () => {
    const { api, screen } = await setup(<AddTextScreen />);
    const result = await api.parseText({ text: 'Apples' });
    let finish!: (value: typeof result) => void;
    jest.spyOn(api, 'parseText').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const create = jest.spyOn(api, 'createItems');
    await parse(screen);
    expect(screen.getByTestId('addText.loading.skeleton')).toBeTruthy();
    await act(() => finish(result));
    await fireEvent.press(screen.getByTestId('addText.select.0'));
    await fireEvent.press(screen.getByTestId('addText.save.button'));
    expect(create).not.toHaveBeenCalled();
  });
});

describe('barcode', () => {
  async function scan(screen: Awaited<ReturnType<typeof setup>>['screen'], data = '012345678905') {
    await fireEvent(screen.getByTestId('addBarcode.camera.scanner'), 'barcodeScanned', { data, type: 'upc_a' });
  }

  test('scans supported codes, edits the result, and saves', async () => {
    const { api, screen } = await setup(<AddBarcodeScreen />);
    const lookup = jest.spyOn(api, 'getBarcode');
    const create = jest.spyOn(api, 'createItems');
    expect(screen.getByTestId('addBarcode.camera.scanner').props.barcodeScannerSettings.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_a', 'upc_e']);
    await scan(screen);
    expect(await screen.findByDisplayValue('Whole grain cereal')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('add.quantity.0'), '3');
    await fireEvent.press(screen.getByTestId('addBarcode.save.button'));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/fridge'));
    expect(lookup).toHaveBeenCalledWith('012345678905');
    expect(create).toHaveBeenCalledWith({ items: [expect.objectContaining({ quantity: 3, source: 'barcode' })] });
  });

  test('not found and Not this both lead to typing', async () => {
    const { screen } = await setup(<AddBarcodeScreen />);
    await scan(screen, '00000000');
    expect(await screen.findByText('Barcode not found')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addBarcode.empty.type'));
    expect(router.replace).toHaveBeenCalledWith('/add-text');
    await fireEvent.press(screen.getByTestId('addBarcode.reset.button'));
    await scan(screen);
    await screen.findByDisplayValue('Whole grain cereal');
    await fireEvent.press(screen.getByTestId('addBarcode.type.button'));
    expect(router.replace).toHaveBeenCalledTimes(2);
  });

  test('lookup failure retries the same code', async () => {
    const { api, screen } = await setup(<AddBarcodeScreen />);
    const lookup = jest.spyOn(api, 'getBarcode').mockRejectedValueOnce(new ApiError(502, 'upstream_unavailable', 'Lookup unavailable'));
    await scan(screen);
    expect(await screen.findByText('Lookup unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addBarcode.lookup.retry'));
    expect(await screen.findByDisplayValue('Whole grain cereal')).toBeTruthy();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  test('camera denied exposes Settings, typing, and permission retry', async () => {
    jest.mocked(useCameraPermissions).mockReturnValue([deniedPermission, requestPermission, requestPermission]);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const { screen } = await setup(<AddBarcodeScreen />);
    expect(screen.getByText('Camera access is off')).toBeTruthy();
    expect(screen.queryByTestId('addBarcode.camera.scanner')).toBeNull();
    await fireEvent.press(screen.getByTestId('addBarcode.settings.button'));
    await fireEvent.press(screen.getByTestId('addBarcode.picker.retry'));
    await fireEvent.press(screen.getByTestId('addBarcode.type.button'));
    expect(settings).toHaveBeenCalled();
    expect(requestPermission).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/add-text');
  });

  test('shows a skeleton during lookup and ignores results after Cancel', async () => {
    const { api, screen } = await setup(<AddBarcodeScreen />);
    const result = await api.getBarcode('012345678905');
    let finish!: (value: typeof result) => void;
    jest.spyOn(api, 'getBarcode').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await scan(screen);
    expect(screen.getByTestId('addBarcode.loading.skeleton')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addBarcode.reset.button'));
    await act(() => finish(result));
    expect(screen.getByTestId('addBarcode.camera.scanner')).toBeTruthy();
    expect(screen.queryByDisplayValue('Whole grain cereal')).toBeNull();
  });
});

describe('receipt', () => {
  test.each(['camera', 'library'])('%s photo shows raw lines, food count, prices, and selected food save', async (source) => {
    const { api, screen } = await setup(<AddReceiptScreen />, 'EUR');
    const create = jest.spyOn(api, 'createItems');
    await fireEvent.press(screen.getByTestId(`addReceipt.${source}.button`));
    expect(await screen.findByText('1 food item')).toBeTruthy();
    expect(screen.getByText('MOCK FOOD 2.50')).toBeTruthy();
    expect(screen.getByText('PAPER TOWELS 3.00')).toBeTruthy();
    expect(screen.getByText('€2.50')).toBeTruthy();
    expect(screen.getByText('Not food')).toBeTruthy();
    expect(screen.getByTestId('addReceipt.select.1').props.accessibilityState.checked).toBe(false);
    expect(screen.queryByTestId('addReceipt.expiryBadge.1')).toBeNull();
    expect(screen.getByText('Receipt total · €5.50')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.save.button'));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/fridge'));
    expect(create).toHaveBeenCalledWith({ items: [expect.objectContaining({ name: 'Mock receipt item', source: 'receipt', est_price: 2.5 })] });
  });

  test('analysis failure retries the same photo', async () => {
    const { api, screen } = await setup(<AddReceiptScreen />);
    const analyze = jest.spyOn(api, 'fromReceipt').mockRejectedValueOnce(new Error('Reader unavailable'));
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    expect(await screen.findByText('Reader unavailable')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.analysis.retry'));
    expect(await screen.findByText('1 food item')).toBeTruthy();
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });

  test('empty result and canceled picker leave a way to retry', async () => {
    const { api, screen } = await setup(<AddReceiptScreen />);
    const analyze = jest.spyOn(api, 'fromReceipt').mockResolvedValueOnce({ candidates: [], total: null, categorized_by: 'heuristic', source: 'ocr' });
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    expect(await screen.findByTestId('addReceipt.review.empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.empty.retry'));
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    expect(screen.getByTestId('addReceipt.picker.empty')).toBeTruthy();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  test('analyzing is cancellable and a late response cannot replace a newer receipt', async () => {
    const { api, screen } = await setup(<AddReceiptScreen />);
    const result = await api.fromReceipt({ uri: 'mock' });
    let finish!: (value: ReceiptCandidatesResponse) => void;
    jest.spyOn(api, 'fromReceipt').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    expect(screen.getByTestId('addReceipt.loading.skeleton')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.analysis.cancel'));
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    await screen.findByText('1 food item');
    await act(() => finish({ ...result, candidates: [] }));
    expect(screen.getByText('1 food item')).toBeTruthy();
    expect(screen.queryByTestId('addReceipt.review.empty')).toBeNull();
  });

  test('camera denied still permits library or typing', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue(deniedPermission);
    const { screen } = await setup(<AddReceiptScreen />);
    await fireEvent.press(screen.getByTestId('addReceipt.camera.button'));
    expect(await screen.findByText('Camera access is off')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.type.button'));
    expect(router.push).toHaveBeenCalledWith('/add-text');
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    expect(await screen.findByText('1 food item')).toBeTruthy();
  });

  test('save failure retains selections and retries', async () => {
    const { api, screen } = await setup(<AddReceiptScreen />);
    const create = jest.spyOn(api, 'createItems').mockRejectedValueOnce(new Error('Save unavailable'));
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
    await screen.findByText('1 food item');
    await fireEvent.press(screen.getByTestId('addReceipt.save.button'));
    expect(await screen.findByTestId('addReceipt.save.error')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('addReceipt.save.retry'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][0].items).toHaveLength(1);
  });
});
