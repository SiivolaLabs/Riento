import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

import { secureStorage, secureStorageOptions } from "./secureStorage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const authIdentityMarkerKey = "riento.authIdentityPresent.v1";
const secureStoreChunkSize = 1800;
const supabaseDatabaseRequestTimeoutMs = 10_000;
const supabaseNetworkRequestTimeoutMs = 15_000;
const platformFetch = globalThis.fetch.bind(globalThis);

export async function clearAuthIdentityMarker() {
  await removeSimpleItem(authIdentityMarkerKey);
}

export async function hasAuthIdentityMarker() {
  return (await getSimpleItem(authIdentityMarkerKey)) === "1";
}

export async function markAuthIdentityPresent() {
  await setSimpleItem(authIdentityMarkerKey, "1");
}

export const authStateStorage = {
  getItem: getSimpleItem,
  removeItem: removeSimpleItem,
  setItem: setSimpleItem
};

const secureStoreAdapter = {
  async getItem(key: string) {
    const manifest = await getChunkManifest(key);

    if (!manifest) {
      return secureStorage.getItemAsync(key);
    }

    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) => secureStorage.getItemAsync(getChunkKey(key, manifest.generation, index)))
    );

    if (chunks.some((chunk) => chunk === null)) {
      throw new Error("The saved authentication session is incomplete.");
    }

    return chunks.join("");
  },
  async removeItem(key: string) {
    const manifest = await getChunkManifest(key);

    if (key.endsWith("-auth-token") && await secureStoreAdapter.getItem(key)) {
      await markAuthIdentityPresent();
    }

    await Promise.all([
      secureStorage.deleteItemAsync(key),
      secureStorage.deleteItemAsync(getManifestKey(key)),
      ...(manifest
        ? Array.from({ length: manifest.count }, (_, index) => secureStorage.deleteItemAsync(getChunkKey(key, manifest.generation, index)))
        : [])
    ]);
  },
  async setItem(key: string, value: string) {
    const previousManifest = await getChunkManifest(key);
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const chunks = value.match(new RegExp(`.{1,${secureStoreChunkSize}}`, "gs")) ?? [""];

    try {
      await Promise.all(chunks.map((chunk, index) => secureStorage.setItemAsync(
        getChunkKey(key, generation, index),
        chunk,
        secureStorageOptions
      )));
      await secureStorage.setItemAsync(
        getManifestKey(key),
        JSON.stringify({ count: chunks.length, generation, version: 1 }),
        secureStorageOptions
      );
    } catch (error) {
      await Promise.all(chunks.map((_, index) => secureStorage.deleteItemAsync(getChunkKey(key, generation, index)))).catch(() => undefined);
      throw error;
    }

    await secureStorage.deleteItemAsync(key).catch(() => undefined);

    if (previousManifest) {
      await Promise.all(Array.from(
        { length: previousManifest.count },
        (_, index) => secureStorage.deleteItemAsync(getChunkKey(key, previousManifest.generation, index))
      )).catch(() => undefined);
    }

    if (key.endsWith("-auth-token")) {
      await markAuthIdentityPresent();
    }
  }
};

const webStorageAdapter = {
  async getItem(key: string) {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage.getItem(key);
  },
  async removeItem(key: string) {
    if (typeof globalThis.localStorage !== "undefined") {
      if (key.endsWith("-auth-token") && globalThis.localStorage.getItem(key)) {
        globalThis.localStorage.setItem(authIdentityMarkerKey, "1");
      }

      globalThis.localStorage.removeItem(key);
    }
  },
  async setItem(key: string, value: string) {
    if (typeof globalThis.localStorage !== "undefined") {
      globalThis.localStorage.setItem(key, value);

      if (key.endsWith("-auth-token")) {
        globalThis.localStorage.setItem(authIdentityMarkerKey, "1");
      }
    }
  }
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage: Platform.OS === "web" ? webStorageAdapter : secureStoreAdapter
      },
      db: {
        timeout: supabaseDatabaseRequestTimeoutMs
      },
      global: {
        fetch: fetchSupabaseWithTimeout
      }
    })
  : null;

export const missingSupabaseMessage = "Riento's connected contribution features are unavailable because Supabase is not configured.";

async function fetchSupabaseWithTimeout(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Supabase request timed out.")), supabaseNetworkRequestTimeoutMs);
  const sourceSignal = init.signal;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);

  if (sourceSignal?.aborted) {
    abortFromSource();
  } else {
    sourceSignal?.addEventListener("abort", abortFromSource, { once: true });
  }

  try {
    return await platformFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener("abort", abortFromSource);
  }
}

type ChunkManifest = { count: number; generation: string; version: 1 };

async function getChunkManifest(key: string): Promise<ChunkManifest | null> {
  const value = await secureStorage.getItemAsync(getManifestKey(key));

  if (!value) {
    return null;
  }

  const parsed: unknown = JSON.parse(value);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The saved authentication session metadata is invalid.");
  }

  const manifest = parsed as Partial<ChunkManifest>;

  if (manifest.version !== 1
    || !Number.isInteger(manifest.count)
    || !manifest.count
    || manifest.count > 64
    || typeof manifest.generation !== "string") {
    throw new Error("The saved authentication session metadata is invalid.");
  }

  return manifest as ChunkManifest;
}

function getManifestKey(key: string) {
  return `${key}.manifest`;
}

function getChunkKey(key: string, generation: string, index: number) {
  return `${key}.chunk.${generation}.${index}`;
}

async function getSimpleItem(key: string) {
  if (Platform.OS === "web") {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage.getItem(key);
  }

  return secureStorage.getItemAsync(key);
}

async function setSimpleItem(key: string, value: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }

  await secureStorage.setItemAsync(key, value, secureStorageOptions);
}

async function removeSimpleItem(key: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }

  await secureStorage.deleteItemAsync(key);
}
