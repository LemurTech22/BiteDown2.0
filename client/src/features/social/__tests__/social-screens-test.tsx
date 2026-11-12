import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';

import { ApiProvider, MockApiClient, type FoodRequest, type PantryListing } from '@/api';
import { ClaimedItemScreen } from '@/features/social/claimed-item-screen';
import { MyRequestsScreen } from '@/features/social/my-requests-screen';
import { OfferSheet } from '@/features/social/offer-sheet';
import { PantryScreen } from '@/features/social/pantry-screen';
import { RequestComposerScreen } from '@/features/social/request-composer-screen';
import { RequestNote } from '@/features/social/request-note';
import { SocialScreen } from '@/features/social/social-screen';
import { expiryLabel, listingQuantity } from '@/features/social/social-utils';
import { PreferencesProvider } from '@/settings/preferences';

let mockClaimId = 'listing-seed-1';
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: mockClaimId }),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});

const store = { get: async () => null, set: async () => {}, delete: async () => {} };
async function seededClient() {
  const api = new MockApiClient();
  await api.signup({ email: 'social@example.com', password: 'test-password', display_name: 'Sam' });
  return api;
}
async function mount(api: MockApiClient, children: ReactNode) {
  return render(<ApiProvider client={api}><PreferencesProvider store={store}>{children}</PreferencesProvider></ApiProvider>);
}
async function receivedRequest(api: MockApiClient): Promise<FoodRequest> {
  return (await api.getRequests()).requests.find((request) => request.source.type !== 'me')!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClaimId = 'listing-seed-1';
});
afterEach(() => jest.restoreAllMocks());

describe('Social board and Offer confirmation', () => {
  test('routes the pantry, Yours, ask and connect actions and never offers to your own note', async () => {
    const api = await seededClient();
    const screen = await mount(api, <SocialScreen />);
    await screen.findByTestId('social.pantry.widget');
    expect(screen.queryByTestId('social.offer.request-mine')).toBeNull();
    await fireEvent.press(screen.getByTestId('social.pantry.widget'));
    await fireEvent.press(screen.getByTestId('social.yours.button'));
    await fireEvent.press(screen.getByLabelText('Ask for something'));
    await fireEvent.press(screen.getByLabelText('Add friends or groups'));
    expect(router.push).toHaveBeenNthCalledWith(1, '/social/pantry');
    expect(router.push).toHaveBeenNthCalledWith(2, '/social/my-requests');
    expect(router.push).toHaveBeenNthCalledWith(3, '/social/request-new');
    expect(router.push).toHaveBeenNthCalledWith(4, '/social/connect');
  });

  test('shows three food tiles and the remainder without quantities', async () => {
    const api = await seededClient();
    const { listings } = await api.getShare();
    jest.spyOn(api, 'getShare').mockResolvedValue({ listings: Array.from({ length: 7 }, (_, index) => ({
      ...listings[0], id: `tile-${index}`, item: { ...listings[0].item, name: `Food ${index}` },
    })) });
    const screen = await mount(api, <SocialScreen />);
    expect(await screen.findByText('+4')).toBeTruthy();
    expect(screen.getByText('Food 2')).toBeTruthy();
    expect(screen.queryByText('Food 3')).toBeNull();
    expect(screen.queryByText('2 pieces')).toBeNull();
  });

  test('confirms an offer, shows the three consequences and removes the fulfilled note', async () => {
    const api = await seededClient();
    const request = await receivedRequest(api);
    const fulfil = jest.spyOn(api, 'fulfilRequest');
    const screen = await mount(api, <SocialScreen />);
    await screen.findByTestId(`social.offer.${request.id}`);
    await fireEvent.press(screen.getByLabelText(`Offer to ${request.author_name}: ${request.text}`));
    expect(fulfil).not.toHaveBeenCalled();
    expect(screen.getByTestId('offer.sheet.modal')).toHaveProp('animationType', 'fade');
    expect(screen.getByText(`${request.author_name} sees that you have it`)).toBeTruthy();
    expect(screen.getByText('The note comes off the board')).toBeTruthy();
    expect(screen.getByText(`You and ${request.author_name} sort out the handoff`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('offer.confirm.button'));
    await waitFor(() => expect(screen.queryByTestId(`social.request.${request.id}`)).toBeNull());
    expect(fulfil).toHaveBeenCalledWith(request.id);
    expect((await api.getRequests()).requests.some((note) => note.id === request.id)).toBe(false);
  });

  test('keeps a failed offer reviewable and retries it', async () => {
    const api = await seededClient();
    const request = await receivedRequest(api);
    const fulfil = jest.spyOn(api, 'fulfilRequest').mockRejectedValueOnce(new Error('Couldn’t offer.'));
    const screen = await mount(api, <SocialScreen />);
    await screen.findByTestId(`social.offer.${request.id}`);
    await fireEvent.press(screen.getByTestId(`social.offer.${request.id}`));
    await fireEvent.press(screen.getByTestId('offer.confirm.button'));
    expect(await screen.findByText('Couldn’t offer.')).toBeTruthy();
    expect(screen.getByTestId('offer.sheet.modal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('offer.error.retry'));
    await waitFor(() => expect(screen.queryByTestId('offer.sheet.modal')).toBeNull());
    expect(fulfil).toHaveBeenCalledTimes(2);
  });

  test('Cancel closes without fulfilling', async () => {
    const api = await seededClient();
    const fulfil = jest.spyOn(api, 'fulfilRequest');
    const close = jest.fn();
    const screen = await mount(api, <OfferSheet request={await receivedRequest(api)} onClose={close} onFulfilled={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('offer.cancel.button'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(fulfil).not.toHaveBeenCalled();
  });

  test('blocks duplicate fulfilment and dismissal during submission', async () => {
    const api = await seededClient();
    const request = await receivedRequest(api);
    let resolve!: (result: { request: FoodRequest }) => void;
    const fulfil = jest.spyOn(api, 'fulfilRequest').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const close = jest.fn();
    const screen = await mount(api, <OfferSheet request={request} onClose={close} onFulfilled={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('offer.confirm.button'));
    await fireEvent.press(screen.getByTestId('offer.confirm.button'));
    await fireEvent(screen.getByTestId('offer.sheet.modal'), 'requestClose');
    expect(close).not.toHaveBeenCalled();
    expect(fulfil).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('offer.loading.skeleton')).toBeTruthy();
    await act(() => resolve({ request: { ...request, status: 'fulfilled' } }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('expands a note past four lines and labels hidden audiences without leaking names', async () => {
    const api = await seededClient();
    const request = await receivedRequest(api);
    request.audiences.hidden_count = 2;
    const screen = await mount(api, <RequestNote request={request} />);
    expect(screen.getByTestId(`social.text.${request.id}`)).toHaveProp('numberOfLines', 4);
    await fireEvent(screen.getByTestId(`social.measure.${request.id}`, { includeHiddenElements: true }), 'textLayout', {
      nativeEvent: { lines: Array.from({ length: 6 }, () => ({ text: 'line' })) },
    });
    expect(screen.getByText('+2 other groups')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`social.more.${request.id}`));
    expect(screen.getByTestId(`social.text.${request.id}`).props.numberOfLines).toBeUndefined();
    expect(screen.queryByTestId(`social.more.${request.id}`)).toBeNull();
  });
});

describe('Food Pantry', () => {
  test('filters sources, claims once and opens the claimed listing by share id', async () => {
    const api = await seededClient();
    const claim = jest.spyOn(api, 'claimShare');
    const screen = await mount(api, <PantryScreen />);
    await screen.findByTestId('foodPantry.item.listing-seed-0');
    expect(screen.queryByText('On the porch shelf')).toBeNull();
    await fireEvent.press(screen.getByTestId('foodPantry.filter.friends'));
    expect(screen.queryByTestId('foodPantry.item.listing-seed-0')).toBeNull();
    expect(screen.getByTestId('foodPantry.item.listing-seed-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('foodPantry.filter.groups'));
    expect(screen.queryByTestId('foodPantry.item.listing-seed-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('foodPantry.claim.listing-seed-0'));
    expect(await screen.findByTestId('foodPantry.claimed.listing-seed-0')).toBeTruthy();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    await fireEvent.press(screen.getByLabelText('Claimed by you: view pickup'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/social/claimed/[id]', params: { id: 'listing-seed-0' } });
  });

  test('retains the row after a claim error and retries', async () => {
    const api = await seededClient();
    jest.spyOn(api, 'claimShare').mockRejectedValueOnce(new Error('Claim failed.'));
    const screen = await mount(api, <PantryScreen />);
    await screen.findByTestId('foodPantry.claim.listing-seed-0');
    await fireEvent.press(screen.getByTestId('foodPantry.claim.listing-seed-0'));
    expect(await screen.findByText('Claim failed.')).toBeTruthy();
    expect(screen.getByTestId('foodPantry.claim.listing-seed-0')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('foodPantry.claim.error.retry'));
    expect(await screen.findByTestId('foodPantry.claimed.listing-seed-0')).toBeTruthy();
  });
});

describe('Ask for something', () => {
  test('posts one note to Friends and multiple groups with the audience payload', async () => {
    const api = await seededClient();
    const { group } = await api.createGroup({ name: 'Kitchen club' });
    const create = jest.spyOn(api, 'createRequest');
    const screen = await mount(api, <RequestComposerScreen />);
    await screen.findByTestId(`requestComposer.audience.${group.id}`);
    await fireEvent.changeText(screen.getByTestId('requestComposer.note.input'), ' Anyone have rice? ');
    await fireEvent.press(screen.getByTestId('requestComposer.audience.group-flat'));
    await fireEvent.press(screen.getByTestId(`requestComposer.audience.${group.id}`));
    await fireEvent.press(screen.getByTestId('requestComposer.post.button'));
    expect(create).toHaveBeenCalledWith({ text: 'Anyone have rice?', audiences: { friends: true, group_ids: ['group-flat', group.id] } });
    expect(router.back).toHaveBeenCalledTimes(1);
    const posted = (await api.getRequests({ mine: true })).requests.find((request) => request.text === 'Anyone have rice?');
    expect(posted?.audiences.groups).toHaveLength(2);
  });

  test('requires nonblank text and at least one audience and enforces the counter limit', async () => {
    const api = await seededClient();
    const screen = await mount(api, <RequestComposerScreen />);
    await screen.findByTestId('requestComposer.audience.friends');
    expect(screen.getByTestId('requestComposer.post.button')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('requestComposer.note.input'), '   ');
    expect(screen.getByTestId('requestComposer.post.button')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('requestComposer.note.input'), 'Rice');
    await fireEvent.press(screen.getByTestId('requestComposer.audience.friends'));
    expect(screen.getByTestId('requestComposer.post.button')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('requestComposer.audience.group-flat'));
    expect(screen.getByTestId('requestComposer.post.button')).not.toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('requestComposer.note.input'), 'a'.repeat(281));
    expect(screen.getByText('280 / 280')).toBeTruthy();
    expect(screen.getByTestId('requestComposer.note.input')).toHaveProp('value', 'a'.repeat(280));
  });

  test('preserves the draft and audience after a post failure and retries successfully', async () => {
    const api = await seededClient();
    jest.spyOn(api, 'createRequest').mockRejectedValueOnce(new Error('Post failed.'));
    const screen = await mount(api, <RequestComposerScreen />);
    await screen.findByTestId('requestComposer.audience.friends');
    await fireEvent.changeText(screen.getByTestId('requestComposer.note.input'), 'A lemon?');
    await fireEvent.press(screen.getByTestId('requestComposer.post.button'));
    expect(await screen.findByText('Post failed.')).toBeTruthy();
    expect(screen.getByTestId('requestComposer.note.input')).toHaveProp('value', 'A lemon?');
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('requestComposer.post.error.retry'));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
  });
});

describe('Your requests', () => {
  test('uses mine=true, displays named fulfilment and cancels open requests', async () => {
    const api = await seededClient();
    const { requests } = await api.getRequests({ mine: true });
    const done: FoodRequest = { ...requests[0], id: 'done', text: 'Rice', status: 'fulfilled', fulfilled_by: 'friend-ana', fulfilled_by_name: 'Ana Rivera' };
    const get = jest.spyOn(api, 'getRequests').mockResolvedValueOnce({ requests: [...requests, done] });
    const remove = jest.spyOn(api, 'deleteRequest');
    const screen = await mount(api, <MyRequestsScreen />);
    expect(await screen.findByText('Fulfilled by Ana Rivera')).toBeTruthy();
    expect(get).toHaveBeenCalledWith({ mine: true });
    expect(screen.queryByTestId('myRequests.cancel.done')).toBeNull();
    await fireEvent.press(screen.getByTestId('myRequests.cancel.request-mine'));
    await waitFor(() => expect(screen.queryByTestId('myRequests.note.request-mine')).toBeNull());
    expect(remove).toHaveBeenCalledWith('request-mine');
    expect((await api.getRequests({ mine: true })).requests[0].status).toBe('cancelled');
  });

  test('retains an open note on cancel failure and retries', async () => {
    const api = await seededClient();
    jest.spyOn(api, 'deleteRequest').mockRejectedValueOnce(new Error('Cancel failed.'));
    const screen = await mount(api, <MyRequestsScreen />);
    await screen.findByTestId('myRequests.cancel.request-mine');
    await fireEvent.press(screen.getByTestId('myRequests.cancel.request-mine'));
    expect(await screen.findByText('Cancel failed.')).toBeTruthy();
    expect(screen.getByTestId('myRequests.note.request-mine')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('myRequests.cancel.error.retry'));
    expect(await screen.findByTestId('myRequests.empty.state')).toBeTruthy();
  });
});

describe('Claimed item', () => {
  test('loads only your claimed listing and opens its pickup coordinates in Maps', async () => {
    const api = await seededClient();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const screen = await mount(api, <ClaimedItemScreen />);
    expect(await screen.findByText('You claimed this')).toBeTruthy();
    expect(screen.getByText('From Ben Chen')).toBeTruthy();
    expect(screen.getByText('On the porch shelf')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('claimedItem.maps.button'));
    expect(open).toHaveBeenCalledWith('https://maps.apple.com/?ll=29.7604,-95.3698&q=Community%20kitchen');
  });

  test('retries a Maps failure', async () => {
    const api = await seededClient();
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('Maps unavailable.')).mockResolvedValue(undefined);
    const screen = await mount(api, <ClaimedItemScreen />);
    await screen.findByTestId('claimedItem.maps.button');
    await fireEvent.press(screen.getByTestId('claimedItem.maps.button'));
    expect(await screen.findByText('Maps unavailable.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('claimedItem.maps.error.retry'));
    await waitFor(() => expect(screen.queryByTestId('claimedItem.maps.error.state')).toBeNull());
    expect(open).toHaveBeenCalledTimes(2);
  });

  test.each(['none', 'note-only'] as const)('handles %s pickup without a map link', async (kind) => {
    const api = await seededClient();
    const { listings } = await api.getShare();
    jest.spyOn(api, 'getShare').mockResolvedValue({ listings: listings.map((listing) => ({ ...listing,
      pickup: kind === 'none' ? null : { note: 'Ask at reception', place_name: null, lat: null, lng: null }, pickup_set: kind !== 'none',
    })) });
    const screen = await mount(api, <ClaimedItemScreen />);
    await screen.findByText('You claimed this');
    expect(screen.queryByTestId('claimedItem.maps.button')).toBeNull();
    if (kind === 'none') expect(screen.queryByTestId('claimedItem.pickup.card')).toBeNull();
    else expect(screen.getByText('Ask at reception')).toBeTruthy();
  });

  test('does not reveal an unclaimed listing on a direct route', async () => {
    mockClaimId = 'listing-seed-0';
    const screen = await mount(await seededClient(), <ClaimedItemScreen />);
    expect(await screen.findByTestId('claimedItem.empty.state')).toBeTruthy();
    expect(screen.queryByTestId('claimedItem.pickup.card')).toBeNull();
  });
});

test.each([
  ['social', SocialScreen, 'getShare'],
  ['foodPantry', PantryScreen, 'getShare'],
  ['requestComposer', RequestComposerScreen, 'getGroups'],
  ['myRequests', MyRequestsScreen, 'getRequests'],
  ['claimedItem', ClaimedItemScreen, 'getShare'],
] as const)('%s shows a loading skeleton and recovers from a data error', async (id, Screen, method) => {
  const api = await seededClient();
  let reject!: (error: Error) => void;
  jest.spyOn(api, method).mockImplementationOnce(() => new Promise<never>((_, fail) => { reject = fail; }));
  const screen = await mount(api, <Screen />);
  expect(screen.getByTestId(`${id}.loading.skeleton`)).toBeTruthy();
  await act(() => reject(new Error('Offline.')));
  expect(await screen.findByText('Offline.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`${id}.error.retry`));
  await waitFor(() => expect(screen.queryByTestId(`${id}.error.state`)).toBeNull());
  await waitFor(() => expect(screen.queryByTestId(`${id}.loading.skeleton`)).toBeNull());
});

test.each([
  ['social', SocialScreen], ['foodPantry', PantryScreen], ['myRequests', MyRequestsScreen],
] as const)('%s renders an empty state', async (id, Screen) => {
  const api = await seededClient();
  jest.spyOn(api, 'getShare').mockResolvedValue({ listings: [] });
  jest.spyOn(api, 'getRequests').mockResolvedValue({ requests: [] });
  const screen = await mount(api, <Screen />);
  expect(await screen.findByTestId(`${id}.empty.state`)).toBeTruthy();
});

test('expiry vocabulary and quantity units follow the shared conventions', async () => {
  const today = new Date(2026, 10, 9);
  expect(expiryLabel('2026-11-08', today)?.label).toBe('Expired');
  expect(expiryLabel('2026-11-09', today)?.label).toBe('Today');
  expect(expiryLabel('2026-11-10', today)?.label).toBe('Tomorrow');
  expect(expiryLabel('2026-11-12', today)?.label).toBe('2–3 days');
  expect(expiryLabel('2026-11-19', today)?.label).toBe('1–2 weeks');
  expect(expiryLabel('2026-11-27', today)?.label).toBe('2–3 weeks');
  expect(expiryLabel('2026-12-09', today)?.label).toBe('3+ weeks');
  expect(expiryLabel(null, today)).toBeNull();
  const { listings } = await (await seededClient()).getShare();
  const listing: PantryListing = { ...listings[0], item: { ...listings[0].item, quantity: 1, unit: 'kg' } };
  expect(listingQuantity(listing, 'us')).toBe('2.2 lb');
  expect(listingQuantity(listing, 'metric')).toBe('1.0 kg');
});
