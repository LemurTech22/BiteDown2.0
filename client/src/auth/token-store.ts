import { deviceStore } from '@/storage/key-value-store';

const AUTH_TOKEN_KEY = 'auth.token';

export const tokenStore = {
  get: () => deviceStore.get(AUTH_TOKEN_KEY),
  async set(token: string | null): Promise<void> {
    if (token === null) {
      await deviceStore.delete(AUTH_TOKEN_KEY);
    } else {
      await deviceStore.set(AUTH_TOKEN_KEY, token);
    }
  },
};
