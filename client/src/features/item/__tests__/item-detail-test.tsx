import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import { ApiProvider, MockApiClient, type Item, type ItemsResponse } from '@/api';
import { NoticeProvider } from '@/components/notice/notice';
import { ItemDetailScreen } from '@/features/item/item-detail-screen';
import { PreferencesProvider } from '@/settings/preferences';
import { FOOD_GROUPS } from '@/features/fridge/fridge-utils';

let mockId = '';
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockId }), router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn() } }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

async function seed() {
  const api = new MockApiClient();
  await api.signup({ email: 'item@example.com', password: 'password-for-demo', display_name: 'Priya' });
  const { items: [item] } = await api.createItems({ items: [{ name: 'Baby spinach', category: 'produce_leafy', food_group: 'veggies', predicted_expiry: '2027-01-01', expiry_source: 'ml', quantity: 2, unit: 'bag' }] });
  mockId = item.id;
  return { api, item };
}
async function show(api: MockApiClient) {
  const values = new Map<string, string>();
  const store = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } };
  const screen = await render(<ApiProvider client={api}><PreferencesProvider store={store}><NoticeProvider><ItemDetailScreen /></NoticeProvider></PreferencesProvider></ApiProvider>);
  return screen;
}
const photo: ImagePicker.ImagePickerResult = { canceled: false, assets: [{ uri: 'file:///spinach.jpg', width: 800, height: 600, fileName: 'spinach.jpg', mimeType: 'image/jpeg' }] };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(true);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(photo);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(photo);
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as ImagePicker.CameraPermissionResponse);
});
afterEach(() => jest.restoreAllMocks());

test('summary rows open only their own editor and all choices remain available', async () => {
  const { api } = await seed();
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  expect(screen.getByTestId('item.screen.root')).toHaveProp('edges', expect.objectContaining({ top: 'additive' }));
  expect(screen.getAllByText('Item detail')).toHaveLength(1);
  expect(screen.queryByTestId('item.save.button')).toBeNull();
  expect(screen.queryByTestId('item.name.input')).toBeNull();
  expect(screen.getByTestId('item.storage.row')).toHaveProp('accessibilityLabel', 'Stored in, Fridge');
  for (const field of ['storage', 'expiry', 'freshness', 'group', 'amount']) {
    await fireEvent.press(screen.getByTestId(`item.${field}.row`));
    expect(screen.getByTestId('item.edit.sheet')).toHaveProp('animationType', 'fade');
    if (field === 'group') for (const { label } of FOOD_GROUPS) expect(screen.getByRole('radio', { name: label })).toBeTruthy();
    if (field === 'storage') {
      expect(screen.getAllByRole('radio')).toHaveLength(3);
      expect(screen.getByRole('radio', { name: 'Fridge' })).toHaveProp('accessibilityState', { checked: true, disabled: false });
    }
    if (field === 'freshness') expect(screen.getAllByRole('radio')).toHaveLength(4);
    if (field === 'expiry') expect(screen.getByTestId('item.edit.date.quick.0')).toBeTruthy();
    if (field === 'amount') expect(screen.getByDisplayValue('Baby spinach')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item.edit.sheet.cancel'));
    expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  }
});

test('name and amount validate, save once, close the sheet and show a notice without navigating', async () => {
  const { api, item } = await seed();
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.amount.row'));
  await fireEvent.changeText(screen.getByTestId('item.edit.quantity.input'), '0');
  expect(screen.getByTestId('item.edit.save')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('item.edit.name.input'), 'Spinach');
  await fireEvent.changeText(screen.getByTestId('item.edit.quantity.input'), '3');
  await fireEvent.changeText(screen.getByTestId('item.edit.unit.input'), 'box');
  await fireEvent.press(screen.getByTestId('item.edit.save'));
  expect(await screen.findByText('Saved changes to Spinach')).toBeTruthy();
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(item.id, { name: 'Spinach', quantity: 3, unit: 'box' });
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});

test.each([['freshness', 'semi_fresh', { freshness: 'semi_fresh' }], ['group', 'protein', { food_group: 'protein' }]])(
  '%s selection saves immediately and closes', async (field, value, patch) => {
    const { api, item } = await seed();
    const update = jest.spyOn(api, 'updateItem');
    const screen = await show(api);
    await screen.findByText('Baby spinach');
    await fireEvent.press(screen.getByTestId(`item.${field}.row`));
    await fireEvent.press(screen.getByTestId(`item.edit.${field}.${value}`));
    expect(await screen.findByText('Saved changes to Baby spinach')).toBeTruthy();
    expect(update).toHaveBeenCalledWith(item.id, patch);
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  });

test('failed date selection stays open and retries the same patch', async () => {
  const { api, item } = await seed();
  const update = jest.spyOn(api, 'updateItem').mockRejectedValueOnce(new Error('Save failed'));
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).toContain('estimated');
  await fireEvent.press(screen.getByTestId('item.expiry.row'));
  await fireEvent.press(screen.getByTestId('item.edit.date.day.2027-01-02'));
  expect(await screen.findByText('Save failed')).toBeTruthy();
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  expect(screen.queryByTestId('app.notice')).toBeNull();
  await fireEvent.press(screen.getByTestId('item.edit.retry'));
  await screen.findByText('Saved changes to Baby spinach');
  expect(update).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenLastCalledWith(item.id, { predicted_expiry: '2027-01-02' });
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).not.toContain('estimated');
});

test.each([false, true])('storage preserves user dates unless re-estimate is %s', async (reestimate) => {
  const { api, item } = await seed();
  await api.updateItem(item.id, { predicted_expiry: '2027-01-02' });
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.storage.row'));
  if (reestimate) await fireEvent.press(screen.getByTestId('item.edit.reestimate'));
  await fireEvent.press(screen.getByTestId('item.edit.storage.freezer'));
  await screen.findByText('Saved changes to Baby spinach');
  expect(update).toHaveBeenCalledWith(item.id, { storage: 'freezer', ...(reestimate ? { reestimate_expiry: true } : {}) });
});

test('confirming the existing expiry preserves its estimated source', async () => {
  const { api, item } = await seed();
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.expiry.row'));
  await fireEvent.press(screen.getByTestId('item.edit.date.day.2027-01-01'));
  await screen.findByText('Saved changes to Baby spinach');
  expect(update).toHaveBeenCalledWith(item.id, {});
  expect(screen.getByTestId('item.expiry.row').props.accessibilityLabel).toContain('estimated');
});

test('estimated storage moves let the server update expiry', async () => {
  const { api, item } = await seed();
  const update = jest.spyOn(api, 'updateItem');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.storage.row'));
  expect(screen.getByText('Expiry updates for the new spot.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.edit.storage.pantry'));
  await screen.findByText('Saved changes to Baby spinach');
  expect(update).toHaveBeenCalledWith(item.id, { storage: 'pantry' });
});

test('double selection and close while saving cannot save or close twice', async () => {
  const { api, item } = await seed();
  let finish!: (value: { item: Item }) => void;
  const update = jest.spyOn(api, 'updateItem').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.freshness.row'));
  const button = screen.getByTestId('item.edit.freshness.fresh');
  await fireEvent.press(button);
  await fireEvent.press(button);
  await fireEvent(screen.getByTestId('item.edit.sheet'), 'requestClose');
  expect(screen.getByTestId('item.edit.sheet')).toBeTruthy();
  expect(update).toHaveBeenCalledTimes(1);
  await act(() => finish({ item }));
  expect(await screen.findByText('Saved changes to Baby spinach')).toBeTruthy();
  expect(screen.queryByTestId('item.edit.sheet')).toBeNull();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
});

test('removed items expose no editing or mutation controls', async () => {
  const { api, item } = await seed();
  await api.removeItem(item.id, { outcome: 'used' });
  const screen = await show(api);
  await screen.findByTestId('item.removed.state');
  expect(screen.queryByTestId('item.summary')).toBeNull();
  expect(screen.queryByTestId('item.remove.button')).toBeNull();
  expect(screen.queryByTestId('item.share.toggle')).toBeNull();
});

test('load error retries, and missing items have an empty state', async () => {
  const { api } = await seed();
  let reject!: (reason: Error) => void;
  jest.spyOn(api, 'getItems').mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const screen = await show(api);
  expect(screen.getByTestId('item.loading.skeleton')).toBeTruthy();
  await act(() => reject(new Error('Offline')));
  expect(await screen.findByText('Offline')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.error.retry'));
  await screen.findByText('Baby spinach');
  await screen.unmount();
  mockId = 'missing';
  expect(await (await show(api)).findByTestId('item.empty.state')).toBeTruthy();
});

test('shares to friends, shows unclaimed status, and stops sharing', async () => {
  const { api, item } = await seed();
  const create = jest.spyOn(api, 'createShare');
  const remove = jest.spyOn(api, 'deleteShare');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  expect(screen.getByText('Share with friends')).toBeTruthy();
  expect(screen.getByLabelText('Share with friends')).toBeTruthy();
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', true);
  expect(await screen.findByText('Not claimed yet')).toBeTruthy();
  expect(screen.getByText('Visible to: Friends')).toBeTruthy();
  expect(create).toHaveBeenCalledWith({ item_id: item.id });
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', false);
  await waitFor(() => expect(screen.queryByText('Not claimed yet')).toBeNull());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('photo recheck sends single mode and patches freshness only', async () => {
  const { api, item } = await seed();
  const fromPhoto = jest.spyOn(api, 'fromPhoto');
  const update = jest.spyOn(api, 'updateItem');
  const create = jest.spyOn(api, 'createItems');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.photo.button'));
  await fireEvent.press(screen.getByTestId('item.photo.library'));
  await waitFor(() => expect(update).toHaveBeenCalledWith(item.id, { freshness: 'fresh' }));
  expect(fromPhoto).toHaveBeenCalledWith({ uri: 'file:///spinach.jpg', fileName: 'spinach.jpg', mimeType: 'image/jpeg', mode: 'single' });
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByText('Baby spinach')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('photo error retries the selected photo and cancellation performs no analysis', async () => {
  const { api } = await seed();
  const analyze = jest.spyOn(api, 'fromPhoto').mockRejectedValueOnce(new Error('Scanner busy'));
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.photo.button'));
  await fireEvent.press(screen.getByTestId('item.photo.camera'));
  expect(await screen.findByText('Scanner busy')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.mutation.retry'));
  await waitFor(() => expect(screen.queryByTestId('item.photo.chooser')).toBeNull());
  expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
  expect(analyze).toHaveBeenCalledTimes(2);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
  await fireEvent.press(screen.getByTestId('item.photo.button'));
  await fireEvent.press(screen.getByTestId('item.photo.library'));
  expect(analyze).toHaveBeenCalledTimes(2);
});

test('pickup needs a note or pin, enforces the counter, saves locally, uses saved spots and removes', async () => {
  const { api, item } = await seed();
  const { listing } = await api.createShare({ item_id: item.id });
  const update = jest.spyOn(api, 'updateShare');
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.pickup.add'));
  expect(screen.getByTestId('item.pickup.sheet')).toHaveProp('animationType', 'fade');
  expect(screen.getByTestId('item.pickup.done')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('item.pickup.place'), 'Home');
  expect(screen.getByTestId('item.pickup.done')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('item.pickup.note'), 'On the porch');
  expect(screen.getByTestId('item.pickup.note')).toHaveProp('maxLength', 120);
  expect(screen.getByText('12/120')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.pickup.saveSpot'));
  await screen.findByText('Spot saved');
  await fireEvent.changeText(screen.getByTestId('item.pickup.note'), 'Different');
  await fireEvent.press(screen.getByTestId('item.pickup.saved0'));
  expect(screen.getByDisplayValue('On the porch')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.pickup.done'));
  expect(update).toHaveBeenCalledWith(listing.id, { pickup: { note: 'On the porch', place_name: 'Home', lat: null, lng: null } });
  await fireEvent.press(screen.getByTestId('item.pickup.edit'));
  await fireEvent.press(screen.getByTestId('item.pickup.remove'));
  expect(update).toHaveBeenLastCalledWith(listing.id, { pickup: null });
  expect(await screen.findByTestId('item.pickup.add')).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('app.notice')).toBeNull();
});

test('location permissions and pickup server errors can be retried', async () => {
  const { api, item } = await seed();
  await api.createShare({ item_id: item.id });
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({ granted: false } as Location.LocationPermissionResponse);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ granted: true } as Location.LocationPermissionResponse);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({ coords: { latitude: 29.7, longitude: -95.3 } } as Location.LocationObject);
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent.press(screen.getByTestId('item.pickup.add'));
  await fireEvent.press(screen.getByTestId('item.pickup.location'));
  expect(await screen.findByTestId('item.pickup.error')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.pickup.retry'));
  expect(await screen.findByTestId('item.pickup.pin')).toBeTruthy();
  jest.spyOn(api, 'updateShare').mockRejectedValueOnce(new Error('Pickup failed'));
  await fireEvent.press(screen.getByTestId('item.pickup.done'));
  expect(await screen.findByText('Pickup failed')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.pickup.retry'));
  await waitFor(() => expect(screen.queryByTestId('item.pickup.sheet')).toBeNull());
});

test('claimed owner handoff preselects Shared it and claimer; normal Remove stays unselected; Maps opens geo URL', async () => {
  const { api, item } = await seed();
  const claimed: Item = { ...item, share: { id: 'claimed-listing', status: 'open', audience: { friends: true, groups: [] }, claimed_by: { id: 'friend-ana', name: 'Ana Rivera' },
    pickup: { note: 'At the desk', place_name: 'Home', lat: 29.7, lng: -95.3 } } };
  jest.spyOn(api, 'getItems').mockResolvedValue({ items: [claimed] });
  const maps = jest.spyOn(Linking, 'openURL').mockResolvedValue();
  const remove = jest.spyOn(api, 'removeItem');
  const screen = await show(api);
  await screen.findByText('Claimed by Ana Rivera');
  expect(screen.getByText('Shared with friends')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.pickup.maps'));
  expect(maps).toHaveBeenCalledWith('https://maps.apple.com/?ll=29.7,-95.3&q=Home');
  await fireEvent.press(screen.getByTestId('item.remove.button'));
  expect(screen.queryByTestId('remove.recipient.section')).toBeNull();
  await fireEvent.press(screen.getByTestId('remove.cancel.button'));
  await fireEvent.press(screen.getByTestId('item.given.button'));
  expect(screen.getByTestId('remove.recipient.button')).toHaveProp('accessibilityLabel', 'Given to Ana Rivera, Claimed it');
  expect(remove).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('remove.shared.done'));
  expect(remove).toHaveBeenCalledWith(item.id, { outcome: 'donated' });
  expect(await screen.findByTestId('item.removed.state')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`remove.undo.${item.id}`));
  await screen.findByText('Baby spinach');
});

test('share failures show Try again and retain the item', async () => {
  const { api } = await seed();
  jest.spyOn(api, 'createShare').mockRejectedValueOnce(new Error('Share failed'));
  const screen = await show(api);
  await screen.findByText('Baby spinach');
  await fireEvent(screen.getByTestId('item.share.toggle'), 'valueChange', true);
  expect(await screen.findByText('Share failed')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('item.mutation.retry'));
  expect(await screen.findByText('Not claimed yet')).toBeTruthy();
  expect((await api.getItems() as ItemsResponse).items[0].removed_at).toBeNull();
});
