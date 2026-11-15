import { resetLoadedPhotosForTests } from '@/components/ui/loaded-photos';

// ItemThumb remembers which photos have faded in for the whole app session; tests start from a clean session.
afterEach(() => resetLoadedPhotosForTests());
