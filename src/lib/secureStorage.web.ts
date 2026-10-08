export const secureStorage = {
  async deleteItemAsync(key: string) {
    globalThis.localStorage?.removeItem(key);
  },
  async getItemAsync(key: string) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItemAsync(key: string, value: string) {
    globalThis.localStorage?.setItem(key, value);
  }
};

export const secureStorageOptions = undefined;
