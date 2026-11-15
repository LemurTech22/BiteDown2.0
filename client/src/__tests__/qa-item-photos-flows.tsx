import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import type { ReactElement } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { ApiProvider, MockApiClient, type Item, type ItemCandidate, type PantryListing } from '@/api';
import { AddPhotoScreen } from '@/features/add/add-photo-screen';
import { AddTextScreen } from '@/features/add/add-text-screen';
import { AddReceiptScreen } from '@/features/add/add-receipt-screen';
import { AddBarcodeScreen } from '@/features/add/add-barcode-screen';
import { ItemRow } from '@/features/fridge/item-row';
import { GroupPantryRow } from '@/features/connect/group-pantry-row';
import { FoodTile } from '@/features/social/social-ui';
import { ItemDetailScreen } from '@/features/item/item-detail-screen';
import { HomeScreen } from '@/features/home/home-screen';
import { RecentlyRemovedScreen } from '@/features/removed/recently-removed-screen';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { PreferencesProvider } from '@/settings/preferences';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: () => ({ id: 'qa-photo' }),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) };
});
jest.mock('expo-camera', () => ({ CameraView: jest.requireActual('react-native').View, useCameraPermissions: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/auth/auth-provider', () => ({ useAuth: () => ({ user: { id: 'qa-user', display_name: 'QA' } }) }));
jest.mock('@/components/server-error', () => ({ reportServerError: jest.fn() }));
jest.mock('@/storage/key-value-store', () => ({ deviceStore: { get: async () => null, set: async () => {}, delete: async () => {} } }));

const hidden = { includeHiddenElements: true };
const photoUrl = 'https://api.test/items/qa-photo/photo?sig=a';
const candidate: ItemCandidate = { name: 'Apples', category: 'produce_hardy', food_group: 'fruit', storage: 'fridge',
  quantity: 1, unit: 'piece', est_price: 1, predicted_expiry: '2026-12-01', expiry_source: 'default' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false,
    assets: [{ uri: 'file:///whole-fridge.jpg', width: 800, height: 600 }] });
  jest.mocked(useCameraPermissions).mockReturnValue([
    { granted: true, status: 'granted', canAskAgain: true, expires: 'never' } as ImagePicker.CameraPermissionResponse, jest.fn(), jest.fn(),
  ]);
});
afterEach(() => jest.restoreAllMocks());

async function client() {
  const api = new MockApiClient();
  await api.signup({ email: 'flows-qa@example.com', password: 'password-qa', display_name: 'QA' });
  return api;
}
async function show(api: MockApiClient, element: ReactElement) {
  const store = { get: async () => null, set: async () => {}, delete: async () => {} };
  return render(<ApiProvider client={api}><PreferencesProvider store={store}>{element}</PreferencesProvider></ApiProvider>, {
    wrapper: ({ children }) => <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>{children}</SafeAreaInsetsContext.Provider>,
  });
}

test.each(['fridge', 'single'] as const)('%s photo review keeps edited crop tokens and excludes a dropped candidate', async (mode) => {
  const api = await client();
  jest.spyOn(api, 'fromPhoto').mockResolvedValue({ source: 'yolo', candidates: [
    { ...candidate, photo_token: 'keep-token', photo_preview_url: photoUrl },
    { ...candidate, name: 'Eggs', photo_token: 'drop-token', photo_preview_url: 'https://api.test/photos/staged/drop?sig=a' },
  ] });
  const create = jest.spyOn(api, 'createItems');
  const screen = await show(api, <AddPhotoScreen />);
  if (mode === 'single') await fireEvent.press(screen.getByLabelText('Photo mode: One item'));
  await fireEvent.press(screen.getByTestId('add.library.button'));
  await screen.findByTestId('add.edit.0');
  expect(screen.getAllByTestId('itemThumb.photo', hidden)).toHaveLength(2);
  expect(screen.queryByTestId('itemThumb.illustration', hidden)).toBeNull();
  await fireEvent.press(screen.getByTestId('add.edit.0'));
  await fireEvent.press(screen.getByTestId('add.editor.0.amount.row'));
  await fireEvent.changeText(screen.getByTestId('add.editor.0.name.input'), 'Green apples');
  await fireEvent.changeText(screen.getByTestId('add.editor.0.quantity.input'), '2');
  await fireEvent.press(screen.getByTestId('add.editor.0.save'));
  await fireEvent.press(screen.getByTestId('add.edit.0'));
  await fireEvent.press(screen.getByTestId('add.editor.0.expiry.row'));
  await fireEvent.press(screen.getByTestId('add.editor.0.date.day.2026-12-03'));
  await fireEvent.press(screen.getByTestId('add.edit.0'));
  await fireEvent.press(screen.getByTestId('add.editor.0.storage.row'));
  await fireEvent.press(screen.getByTestId('add.editor.0.storage.freezer'));
  await fireEvent.press(screen.getByTestId('add.select.1'));
  expect(within(screen.getByTestId('addReview.footer')).getByTestId('add.save.button')).toBeTruthy();
  expect(within(screen.getByTestId('addReview.scroll')).queryByTestId('add.save.button')).toBeNull();
  await fireEvent.press(screen.getByTestId('add.save.button'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const saved = JSON.parse(JSON.stringify(create.mock.calls[0][0]));
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({ name: 'Green apples', quantity: 2, predicted_expiry: '2026-12-03',
    storage: 'freezer', photo_token: 'keep-token', source: mode === 'single' ? 'single_photo' : 'photo' });
  expect(JSON.stringify(saved)).not.toContain('drop-token');
  expect(saved.items[0]).not.toHaveProperty('photo_preview_url');
});

test.each(['text', 'barcode', 'receipt'] as const)('%s add does not send a photo token', async (method) => {
  const api = await client();
  const create = jest.spyOn(api, 'createItems');
  const screen = await show(api, method === 'text' ? <AddTextScreen /> : method === 'receipt' ? <AddReceiptScreen /> : <AddBarcodeScreen />);
  if (method === 'text') {
    await fireEvent.changeText(screen.getByTestId('addText.input.text'), 'Apples');
    await fireEvent.press(screen.getByTestId('addText.parse.button'));
  } else if (method === 'receipt') {
    await fireEvent.press(screen.getByTestId('addReceipt.library.button'));
  } else {
    await fireEvent(screen.getByTestId('addBarcode.camera.scanner'), 'barcodeScanned', { data: '012345678905' });
  }
  await screen.findByTestId(`add${method === 'text' ? 'Text' : method === 'receipt' ? 'Receipt' : 'Barcode'}.save.button`);
  const prefix = `add${method === 'text' ? 'Text' : method === 'receipt' ? 'Receipt' : 'Barcode'}`;
  await fireEvent.press(screen.getByTestId(`${prefix}.edit.0`));
  await fireEvent.press(screen.getByTestId(`${prefix}.editor.0.amount.row`));
  await fireEvent.changeText(screen.getByTestId(`${prefix}.editor.0.name.input`), 'Edited apples');
  await fireEvent.press(screen.getByTestId(`${prefix}.editor.0.save`));
  expect(within(screen.getByTestId('addReview.footer')).getByTestId(`${prefix}.save.button`)).toBeTruthy();
  expect(within(screen.getByTestId('addReview.scroll')).queryByTestId(`${prefix}.save.button`)).toBeNull();
  await fireEvent.press(screen.getByTestId(`${prefix}.save.button`));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const saved = JSON.parse(JSON.stringify(create.mock.calls[0][0]));
  expect(saved.items[0].name).toBe('Edited apples');
  for (const food of saved.items) {
    expect(food).not.toHaveProperty('photo_token');
    expect(food.source).toBe(method);
  }
});

test.each(['ios', 'android', 'web'] as const)('%s fridge row keeps food label and 44 pt open/remove targets with a decorative photo', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const api = await client();
  const { items: [base] } = await api.createItems({ items: [candidate] });
  const item = { ...base, photo_url: photoUrl };
  const screen = await show(api, <ItemRow item={item} last onRemove={jest.fn()} onMove={jest.fn()} />);
  expect(screen.getByTestId(`fridge.open.${item.id}`).props.accessibilityLabel).toContain('Apples');
  for (const action of ['open', 'remove']) {
    expect(StyleSheet.flatten(screen.getByTestId(`fridge.${action}.${item.id}`).props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
  expect(screen.getByTestId('itemThumb.photo', hidden).props.accessible).toBe(false);
});

const surfaces = ['detail', 'remove', 'recently removed', 'social', 'group', 'home'] as const;
const visuals = ['photo', 'illustration', 'group'] as const;
test.each(surfaces.flatMap((surface) => visuals.map((visual) => [surface, visual] as const)))('%s uses %s according to photo -> illustration -> group', async (surface, visual) => {
  const api = await client();
  const { items: [base] } = await api.createItems({ items: [candidate] });
  const item: Item = { ...base, id: 'qa-photo', name: visual === 'group' ? 'Mystery food' : 'Apples', photo_url: visual === 'photo' ? photoUrl : null };
  if (surface === 'recently removed') { item.removed_at = new Date().toISOString(); item.outcome = 'used'; }
  jest.spyOn(api, 'getItems').mockResolvedValue({ items: [item] });
  const listing: PantryListing = { id: 'listing', item_id: item.id, owner_id: item.owner_id, owner_name: 'QA', group_id: null,
    status: 'open', claimed_by_me: false, created_at: item.added_at, source: { type: 'friend', name: 'QA' },
    item: { name: item.name, category: item.category, quantity: item.quantity, unit: item.unit, predicted_expiry: item.predicted_expiry, photo_url: item.photo_url },
    pickup: null, pickup_set: false };
  const elements = {
    detail: <ItemDetailScreen />, remove: <RemoveSheet item={item} onClose={jest.fn()} onRemoved={jest.fn()} />,
    'recently removed': <RecentlyRemovedScreen />, social: <FoodTile listing={listing} />,
    group: <GroupPantryRow item={item} />, home: <HomeScreen />,
  };
  const screen = await show(api, elements[surface]);
  const image = await screen.findByTestId(`itemThumb.${visual}`, hidden);
  for (const other of visuals.filter((entry) => entry !== visual)) expect(screen.queryByTestId(`itemThumb.${other}`, hidden)).toBeNull();
  if (visual === 'photo') {
    expect(image.props.source).toEqual([expect.objectContaining({ uri: photoUrl })]);
    await fireEvent(image, 'error', { nativeEvent: { error: '404' } });
    expect(screen.getByTestId('itemThumb.illustration', hidden)).toBeTruthy();
  }
});
