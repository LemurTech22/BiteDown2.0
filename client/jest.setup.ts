import { AccessibilityInfo } from 'react-native';

import { resetLoadedPhotosForTests } from '@/components/ui/loaded-photos';

// Match the native method's ordinary function identity. Spying directly on the preset's jest.fn replaces
// its implementation in place, so a test forwarding unhandled events to the saved method recurses.
const addAccessibilityListener = AccessibilityInfo.addEventListener;
AccessibilityInfo.addEventListener = (event, listener) => addAccessibilityListener(event, listener);

// ItemThumb remembers which photos have faded in for the whole app session; tests start from a clean session.
afterEach(() => resetLoadedPhotosForTests());
