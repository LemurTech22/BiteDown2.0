import { act, useState, type ReactNode } from 'react';

import { EditSheet } from '@/components/ui/edit-sheet';

// Exercise the real web Modal/focus trap, rather than changing Platform.OS on native mocks.
function mockDOM() {
  if (typeof document !== 'undefined') return;
  const { JSDOM } = jest.requireActual('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    ShadowRoot: dom.window.ShadowRoot, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle });
}
jest.mock('react-native', () => { mockDOM(); return jest.requireActual('react-native-web'); });
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native-web').View }));
jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

type WebRoot = { render: (node: ReactNode) => void; unmount: () => void };
mockDOM();
const { createRoot } = jest.requireActual<{ createRoot: (host: Element) => WebRoot }>('react-dom/client');
let root: WebRoot;
let host: HTMLDivElement;

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  jest.useRealTimers();
});

function Harness({ pending = false }: { pending?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button id="qa.opener" onClick={() => setOpen(true)}>Open Stored in</button>
    {open ? <EditSheet title="Stored in" testID="qa.web" pending={pending} onClose={() => setOpen(false)}>
      <button id="qa.choice">Fridge</button>
    </EditSheet> : null}
  </>;
}

async function open(pending = false) {
  await act(() => root.render(<Harness pending={pending} />));
  const opener = document.getElementById('qa.opener')!;
  opener.focus();
  await act(() => opener.click());
  // jsdom does not play CSS animations; deliver their completion before checking the real focus trap.
  const animation = document.querySelector('[data-testid="qa.web"]')!.parentElement!.parentElement!;
  await act(() => animation.dispatchEvent(new window.Event('animationend', { bubbles: true })));
  await act(() => jest.advanceTimersByTime(1000));
  return opener;
}

test('web modal moves focus inside, traps outside focus, handles Escape and restores opener focus', async () => {
  const opener = await open();
  const panel = document.querySelector('[data-testid="qa.web.panel"]')!;
  expect(panel.contains(document.activeElement)).toBe(true);
  await act(() => opener.focus());
  expect(panel.contains(document.activeElement)).toBe(true);
  await act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
  await act(() => jest.advanceTimersByTime(1000));
  expect(document.querySelector('[data-testid="qa.web.panel"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('pending web sheet keeps focus trapped and ignores Escape and Cancel', async () => {
  const opener = await open(true);
  const panel = document.querySelector('[data-testid="qa.web.panel"]')!;
  const cancel = document.querySelector<HTMLElement>('[data-testid="qa.web.cancel"]')!;
  expect(cancel.getAttribute('aria-disabled')).toBe('true');
  await act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
  await act(() => cancel.click());
  await act(() => opener.focus());
  expect(document.querySelector('[data-testid="qa.web.panel"]')).toBe(panel);
  expect(panel.contains(document.activeElement)).toBe(true);
});
