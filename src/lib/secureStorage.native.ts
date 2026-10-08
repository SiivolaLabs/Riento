import * as SecureStore from "expo-secure-store";

export const secureStorage = SecureStore;
export const secureStorageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
