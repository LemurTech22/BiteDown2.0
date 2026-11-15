import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { ModuleKind, transpileModule } from 'typescript';

import { FadeIn } from '@/components/ui/fade-in';

const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('node:fs');
const { resolve } = jest.requireActual<{ resolve: (path: string) => string }>('node:path');
const { runInNewContext } = jest.requireActual<{ runInNewContext: (code: string, context: object) => void }>('node:vm');
type Delegate = jest.Mock<{ remove: () => void } | undefined, [string, (enabled: boolean) => void]>;

afterEach(() => jest.restoreAllMocks());

// Execute the actual setup against a controlled delegate. No native mock is treated as an event emitter.
function setupDelegate(delegate: Delegate) {
  const info = { addEventListener: delegate };
  const setup = transpileModule(readFileSync(resolve('jest.setup.ts'), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(setup, {
    exports: {}, afterEach: jest.fn(),
    require: (name: string) => {
      if (name === 'react-native') return { AccessibilityInfo: info };
      if (name === '@/components/ui/loaded-photos') return { resetLoadedPhotosForTests: jest.fn() };
      throw new Error(`Unexpected setup dependency: ${name}`);
    },
  });
  return info;
}

test('setup forwards exact event/callback and subscription; partial spies can delegate and restore without recursion', () => {
  const subscription = { remove: jest.fn() };
  const delegate = jest.fn<ReturnType<Delegate>, Parameters<Delegate>>(() => subscription);
  const info = setupDelegate(delegate);
  const original = info.addEventListener;
  expect(jest.isMockFunction(original)).toBe(false);
  const listener = jest.fn();
  const other = { remove: jest.fn() };
  const spy = jest.spyOn(info, 'addEventListener').mockImplementation((event, handler) => event === 'screenReaderChanged' ? other : original(event, handler));
  expect(info.addEventListener('reduceMotionChanged', listener)).toBe(subscription);
  expect(delegate).toHaveBeenCalledTimes(1);
  expect(delegate).toHaveBeenCalledWith('reduceMotionChanged', listener);
  delegate.mock.calls[0][1](true);
  expect(listener).toHaveBeenCalledWith(true);
  expect(info.addEventListener('screenReaderChanged', listener)).toBe(other);
  spy.mockRestore();
  expect(info.addEventListener).toBe(original);
  expect(info.addEventListener('screenReaderChanged', listener)).toBe(subscription);
  subscription.remove();
  expect(subscription.remove).toHaveBeenCalledTimes(1);
});

test('setup does not catch registration, callback or removal failures or replace a missing subscription', () => {
  const error = new Error('listener bug');
  const delegate = jest.fn<ReturnType<Delegate>, Parameters<Delegate>>(() => { throw error; });
  const info = setupDelegate(delegate);
  const callback = jest.fn(() => { throw error; });
  expect(() => info.addEventListener('reduceMotionChanged', callback)).toThrow(error);
  delegate.mockImplementation((event, listener) => { listener(true); });
  expect(() => info.addEventListener('reduceMotionChanged', callback)).toThrow(error);
  const subscription = { remove: () => { throw error; } };
  delegate.mockImplementation(() => subscription);
  expect(() => info.addEventListener('reduceMotionChanged', callback)!.remove()).toThrow(error);
  delegate.mockImplementation(() => undefined);
  expect(info.addEventListener('reduceMotionChanged', callback)).toBeUndefined();
});

test('real Reduce Motion hook receives live changes through a partial spy and removes exactly its subscription', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const original = AccessibilityInfo.addEventListener;
  let changed!: (enabled: boolean) => void;
  const remove = jest.fn();
  const listener = jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((event, callback) => {
    if (event !== 'reduceMotionChanged') return original(event, callback);
    changed = callback as (enabled: boolean) => void;
    return { remove };
  });
  const screen = await render(<FadeIn testID="qa.fade"><Text>Food</Text></FadeIn>);
  expect(listener).toHaveBeenCalledWith('reduceMotionChanged', expect.any(Function));
  expect(remove).not.toHaveBeenCalled();
  await act(() => changed(true));
  expect(screen.getByTestId('qa.fade')).toHaveStyle({ opacity: 1 });
  await screen.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
  listener.mockRestore();
  expect(AccessibilityInfo.addEventListener).toBe(original);
});
