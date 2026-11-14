import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { ApiProvider, MockApiClient } from '@/api';
import { DiscardSheet } from '@/features/add/discard-sheet';
import { ScanScreen } from '@/features/connect/scan-screen';
import { FridgeScreen } from '@/features/fridge/fridge-screen';
import { ItemRow } from '@/features/fridge/item-row';
import { MoveSheet } from '@/features/fridge/move-sheet';
import { PickupSheet } from '@/features/item/pickup-sheet';
import { RemoveSheet } from '@/features/remove/remove-sheet';
import { RecentlyRemovedScreen } from '@/features/removed/recently-removed-screen';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { OfferSheet } from '@/features/social/offer-sheet';
import { PreferencesProvider } from '@/settings/preferences';
import { createTheme } from '@/theme';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/components/ui/app-icon', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { AppIcon: ({ name }: { name: string }) => React.createElement(Text, { testID: `qa.icon.${name}` }) };
});
jest.mock('@/auth/auth-provider', () => ({ useAuth: () => ({ signOut: jest.fn(), user: { id: 'qa' } }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' } }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});
jest.mock('expo-camera', () => {
  const permission = { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
  const request = jest.fn(async () => permission);
  return { CameraView: () => null, useCameraPermissions: () => [permission, request, request] };
});

const theme = createTheme('light');
const store = { get: async () => null, set: async () => {}, delete: async () => {} };
async function setup() {
  const api = new MockApiClient();
  await api.signup({ email: 'qa-layout@example.com', password: 'qa-password', display_name: 'QA' });
  const { items } = await api.createItems({ items: ['Apples', 'Pears', 'Last food'].map((name) => ({ name, storage: 'fridge' as const })) });
  return { api, items };
}
function mount(api: MockApiClient, child: ReactNode) {
  return render(<ApiProvider client={api}><PreferencesProvider store={store}>{child}</PreferencesProvider></ApiProvider>);
}
async function remove(screen: RenderResult, id: string, batch: boolean) {
  if (batch) {
    await fireEvent.press(screen.getByTestId('fridge.selection.start'));
    await fireEvent.press(screen.getByTestId(`fridge.select.${id}`));
    await fireEvent.press(screen.getByTestId('fridge.batch.used'));
  } else {
    await fireEvent.press(screen.getByTestId(`fridge.remove.${id}`));
    await fireEvent.press(screen.getByTestId('remove.outcome.used'));
  }
}

function scrollContaining(panel: TestInstance) {
  let ancestor = panel.parent;
  while (ancestor && !ancestor.props.contentContainerStyle) ancestor = ancestor.parent;
  expect(ancestor).not.toBeNull();
  return ancestor!;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([false, true])('overlay measurement changes list padding, preserves its style, and leaves working Undo/Dismiss; batch=%s', async (batch) => {
  jest.useFakeTimers();
  const { api, items } = await setup();
  const screen = await mount(api, <FridgeScreen />);
  const beforeStyle = StyleSheet.flatten(screen.getByLabelText('fridge food').props.style);
  await remove(screen, items[0].id, batch);
  const overlay = screen.getByTestId('fridge.undoOverlay');
  expect(overlay).toHaveStyle({ position: 'absolute', bottom: theme.spacing.sm, pointerEvents: 'box-none', maxHeight: '40%' });
  for (const height of [160, 210]) {
    await fireEvent.layout(overlay, { x: 20, y: 400, width: 350, height });
    const list = screen.getByLabelText('fridge food');
    expect(StyleSheet.flatten(list.props.style)).toEqual(beforeStyle);
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(theme.spacing.xxl + height + theme.spacing.sm);
  }
  // Handler reachability only: Jest cannot prove taps hit these screen coordinates.
  await fireEvent.press(screen.getByTestId(`fridge.open.${items[2].id}`));
  const restore = jest.spyOn(api, batch ? 'restoreBatch' : 'restoreItem');
  await fireEvent.press(screen.getByTestId(batch ? 'fridge.batchUndo.1' : `remove.undo.${items[0].id}`));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  await remove(screen, items[1].id, batch);
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  expect(StyleSheet.flatten(screen.getByLabelText('fridge food').props.style)).toEqual(beforeStyle);
  expect(StyleSheet.flatten(screen.getByLabelText('fridge food').props.contentContainerStyle).paddingBottom).toBe(theme.spacing.xxl);
});

test.each([false, true])('CL-13: every transparent overlay container uses box-none style without an empty padding strip; batch=%s', async (batch) => {
  jest.useFakeTimers();
  const { api, items } = await setup();
  const screen = await mount(api, <FridgeScreen />);
  await remove(screen, items[0].id, batch);
  const toast = screen.getByTestId(batch ? 'fridge.batchToast.1' : `remove.toast.${items[0].id}`);
  const overlay = screen.getByTestId('fridge.undoOverlay');
  const scroll = scrollContaining(toast);
  // The Jest ScrollView stub inserts an unstyled View instead of applying
  // contentContainerStyle. Check that real native content-view input explicitly.
  const contentStyle = StyleSheet.flatten(scroll.props.contentContainerStyle);
  expect(contentStyle).toMatchObject({ pointerEvents: 'box-none' });
  for (const padding of [contentStyle.padding, contentStyle.paddingVertical, contentStyle.paddingBottom]) {
    expect(padding ?? 0).toBe(0);
  }
  let ancestor = toast.parent;
  let containers = 0;
  while (ancestor) {
    // Exclude only the stub's synthetic content View; it has no style input.
    if (ancestor !== scroll.children[0]) {
      const style = StyleSheet.flatten(ancestor.props.style);
      expect(style).toMatchObject({ pointerEvents: 'box-none' });
      for (const padding of [style.padding, style.paddingVertical, style.paddingBottom]) {
        expect(padding ?? 0).toBe(0);
      }
      containers += 1;
    }
    if (ancestor === overlay) break;
    ancestor = ancestor.parent;
  }
  expect(ancestor).toBe(overlay);
  expect(containers).toBe(2);
  const restore = jest.spyOn(api, batch ? 'restoreBatch' : 'restoreItem');
  await fireEvent.press(screen.getByTestId(batch ? 'fridge.batchUndo.1' : `remove.undo.${items[0].id}`));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  await remove(screen, items[1].id, batch);
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  // These presses establish descendant handler wiring, not coordinate hit testing.
});

test.each([false, true])('CL-14: the capped scroll contains the panel through restore failure and remeasurement; batch=%s', async (batch) => {
  jest.useFakeTimers();
  const { api, items } = await setup();
  const screen = await mount(api, <FridgeScreen />);
  await remove(screen, items[0].id, batch);
  const panelId = batch ? 'fridge.batchToast.1' : `remove.toast.${items[0].id}`;
  const undoId = batch ? 'fridge.batchUndo.1' : `remove.undo.${items[0].id}`;
  const overlay = screen.getByTestId('fridge.undoOverlay');
  const scroll = scrollContaining(screen.getByTestId(panelId));
  expect(scroll.parent).toBe(overlay);
  expect(overlay).toHaveStyle({ maxHeight: '40%' });
  expect(scroll).toHaveStyle({ flexGrow: 0, flexShrink: 1 });
  expect(scroll.props.scrollEnabled).not.toBe(false);
  const restore = jest.spyOn(api, batch ? 'restoreBatch' : 'restoreItem');
  restore.mockRejectedValueOnce(new Error('Restore unavailable. Try again.'));
  await fireEvent.press(screen.getByTestId(undoId));
  expect(screen.getByRole('alert')).toHaveTextContent('Restore unavailable. Try again.');
  expect(scrollContaining(screen.getByTestId(panelId))).toBe(scroll);
  for (const height of [140, 230, 110]) {
    await fireEvent.layout(overlay, { x: 20, y: 400, width: 350, height });
    expect(StyleSheet.flatten(screen.getByLabelText('fridge food').props.contentContainerStyle).paddingBottom)
      .toBe(theme.spacing.xxl + height + theme.spacing.sm);
  }
  await act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByTestId(panelId)).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId(undoId));
  expect(restore).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  expect(StyleSheet.flatten(screen.getByLabelText('fridge food').props.contentContainerStyle).paddingBottom).toBe(theme.spacing.xxl);
});

test.each([false, true])('replacing a failed panel keeps the other panel type inside one scroll; first batch=%s', async (batch) => {
  jest.useFakeTimers();
  const { api, items } = await setup();
  const screen = await mount(api, <FridgeScreen />);
  await remove(screen, items[0].id, batch);
  jest.spyOn(api, batch ? 'restoreBatch' : 'restoreItem').mockRejectedValueOnce(new Error('Restore unavailable.'));
  await fireEvent.press(screen.getByTestId(batch ? 'fridge.batchUndo.1' : `remove.undo.${items[0].id}`));
  await remove(screen, items[1].id, !batch);
  expect(screen.queryByTestId(batch ? 'fridge.batchToast.1' : `remove.toast.${items[0].id}`)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  const replacement = screen.getByTestId(batch ? `remove.toast.${items[1].id}` : 'fridge.batchToast.1');
  const overlay = screen.getByTestId('fridge.undoOverlay');
  const scroll = scrollContaining(replacement);
  expect(scroll.parent === overlay).toBe(true);
  expect(overlay.children.filter((node) => typeof node !== 'string' && !!node.props.contentContainerStyle)).toHaveLength(1);
  await fireEvent.layout(overlay, { x: 20, y: 400, width: 350, height: 120 });
  expect(StyleSheet.flatten(screen.getByLabelText('fridge food').props.contentContainerStyle).paddingBottom)
    .toBe(theme.spacing.xxl + 120 + theme.spacing.sm);
  await fireEvent.press(screen.getByTestId(batch ? `remove.undo.${items[1].id}` : 'fridge.batchUndo.1'));
  expect(screen.queryByTestId('fridge.undoOverlay')).toBeNull();
  expect(screen.getByTestId(`fridge.open.${items[1].id}`)).toBeOnTheScreen();
});

test.each(['ios', 'android', 'web'] as const)('Remove keeps its icon, name, testID and 44 pt target on %s', async (platform) => {
  jest.replaceProperty(Platform, 'OS', platform);
  const { items } = await setup();
  const onRemove = jest.fn();
  const screen = await render(<ItemRow item={items[0]} last onMove={jest.fn()} onRemove={onRemove} />);
  const button = screen.getByRole('button', { name: 'Remove Apples' });
  expect(button).toHaveProp('testID', `fridge.remove.${items[0].id}`);
  expect(button).toHaveStyle({ width: 44, minHeight: 44 });
  expect(screen.getByTestId('qa.icon.check-circle-outline').parent).toBe(button);
  await fireEvent.press(button);
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('Recently removed adds message spacing only after a successful Put back', async () => {
  const { api, items } = await setup();
  await api.removeItem(items[0].id, { outcome: 'used' });
  const screen = await mount(api, <RecentlyRemovedScreen />);
  expect(screen.getByTestId('removed.message')).toHaveTextContent('');
  expect(StyleSheet.flatten(screen.getByTestId('removed.message').props.style).marginTop).toBeUndefined();
  await fireEvent.press(screen.getByRole('button', { name: 'Put back Apples' }));
  expect(screen.getByTestId('removed.message')).toHaveTextContent('Apples is back in Fridge');
  expect(screen.getByTestId('removed.message')).toHaveStyle({ marginTop: theme.spacing.md });
  expect(screen.getByTestId('removed.message')).toHaveProp('accessibilityLiveRegion', 'polite');
});

describe.each(['ios', 'web'] as const)('sheet width contract on %s', (platform) => {
  test.each(['remove', 'move', 'discard', 'pickup', 'offer', 'delete', 'friend-added'] as const)('%s panel uses the centred 100%% width cap', async (kind) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const { api, items } = await setup();
    const noop = jest.fn();
    let child: ReactNode;
    let target: string;
    switch (kind) {
      case 'remove': child = <RemoveSheet item={items[0]} onClose={noop} onRemoved={noop} />; target = 'remove.cancel.button'; break;
      case 'move': child = <MoveSheet item={items[0]} onClose={noop} onMoved={noop} />; target = 'fridge.move.cancel'; break;
      case 'discard': child = <DiscardSheet onDiscard={noop} onCancel={noop} />; target = 'add.discard.cancel'; break;
      case 'pickup': child = <PickupSheet pickup={null} onSave={async () => {}} onClose={noop} />; target = 'item.pickup.cancel'; break;
      case 'offer': {
        const request = (await api.getRequests()).requests.find((entry) => entry.source.type !== 'me')!;
        child = <OfferSheet request={request} onClose={noop} onFulfilled={noop} />; target = 'offer.cancel.button'; break;
      }
      case 'delete': child = <SettingsScreen />; target = 'settings.delete.cancel'; break;
      case 'friend-added': child = <ScanScreen />; target = 'friendAdded.done.button'; break;
    }
    const screen = await mount(api, child);
    if (kind === 'delete') await fireEvent.press(screen.getByTestId('settings.row.delete'));
    if (kind === 'friend-added') {
      await fireEvent.changeText(screen.getByTestId('friendScan.code.input'), 'DanaDemoCode12345');
      await fireEvent.press(screen.getByTestId('friendScan.code.add'));
    }
    let ancestor: TestInstance | null = screen.getByTestId(target).parent;
    let found = false;
    while (ancestor) {
      const style = StyleSheet.flatten([ancestor.props.style, ancestor.props.contentContainerStyle]);
      if (style?.maxWidth === theme.sizes.webMaxContentWidth) {
        expect(style).toMatchObject({ width: '100%', alignSelf: 'center' });
        found = true;
        break;
      }
      ancestor = ancestor.parent;
    }
    expect(found).toBe(true);
    expect(screen.getByTestId(target)).toHaveProp('accessibilityRole', 'button');
    // Width and maxWidth are layout inputs; physical phone/tablet rendering is unverified.
  });
});
