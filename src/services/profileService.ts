import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { authStateStorage, supabase } from "../lib/supabase";
import { resetMusicRecognitionSettings } from "./musicRecognitionSettingsService";
import { clearSavedVenues } from "./savedVenueService";

export type ProfileSettings = {
  gpsOnMapOpen: boolean;
  manualPlacementEnabled: boolean;
};

export const defaultProfileSettings: ProfileSettings = {
  gpsOnMapOpen: true,
  manualPlacementEnabled: true
};

const profileSettingsKey = "riento.profileSettings.v1";
const pendingDeviceDeletionKey = "riento.pendingDeviceDeletion.v1";
const profileSettingsListeners = new Set<(settings: ProfileSettings) => void>();
let profileSettingsUnavailable = false;
export const unavailableProfileSettings: ProfileSettings = {
  gpsOnMapOpen: false,
  manualPlacementEnabled: false
};

export type PendingDeviceDataDeletion = {
  clearLocalData: boolean;
  expectedProviderSubjects: string[];
  expectedUserId: string;
  googleRevocationStatus: "failed" | "not_needed" | "pending" | "succeeded";
  googleSubject: string | null;
  operationToken: string;
  providerRevocation?: "failed" | "not_needed" | "succeeded";
  requireAnonymous: boolean;
  version: 1;
};

export async function getProfileSettings(): Promise<ProfileSettings> {
  if (profileSettingsUnavailable) {
    throw new Error("Saved settings are unavailable in this app session.");
  }

  const storedValue = await AsyncStorage.getItem(profileSettingsKey);

  if (!storedValue) {
    return defaultProfileSettings;
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    return isProfileSettings(parsedValue) ? parsedValue : unavailableProfileSettings;
  } catch {
    return unavailableProfileSettings;
  }
}

export async function saveProfileSettings(settings: ProfileSettings) {
  try {
    await AsyncStorage.setItem(profileSettingsKey, JSON.stringify(settings));
  } catch (error) {
    profileSettingsUnavailable = true;
    profileSettingsListeners.forEach((listener) => listener(unavailableProfileSettings));
    throw error;
  }

  profileSettingsUnavailable = false;
  profileSettingsListeners.forEach((listener) => listener(settings));
  return { ok: true, message: "Settings saved on this device." };
}

export async function resetProfileSettings() {
  try {
    await AsyncStorage.removeItem(profileSettingsKey);
  } catch (error) {
    profileSettingsUnavailable = true;
    profileSettingsListeners.forEach((listener) => listener(unavailableProfileSettings));
    throw error;
  }

  profileSettingsUnavailable = false;
  profileSettingsListeners.forEach((listener) => listener(defaultProfileSettings));
}

export function subscribeToProfileSettings(listener: (settings: ProfileSettings) => void) {
  profileSettingsListeners.add(listener);
  return () => {
    profileSettingsListeners.delete(listener);
  };
}

export async function getDeviceDataExport(userId: string) {
  if (!supabase) {
    return { ok: false as const, message: "Riento services are not configured.", data: null };
  }

  const { data, error } = await supabase.rpc("get_device_data_export");

  if (error || !data) {
    return { ok: false as const, message: error?.message ?? "Could not prepare the data export.", data: null };
  }

  return {
    ok: true as const,
    message: "Device contribution data ready.",
    data: { ...(data as Record<string, unknown>), privateDeviceSessionId: userId }
  };
}

export async function deleteDeviceData(
  expectedUserId: string,
  requireAnonymous: boolean,
  appleAuthorizationCode?: string,
  expectedProviderSubjects: string[] = [],
  appleNonce?: string,
  clearLocalData = true
) {
  if (!supabase) {
    return deletionFailure("Riento services are not configured.", "not_started");
  }

  const sortedProviderSubjects = [...expectedProviderSubjects].sort();
  let pending = await getPendingDeviceDataDeletion();

  if (pending && (pending.expectedUserId !== expectedUserId
    || pending.requireAnonymous !== requireAnonymous
    || pending.clearLocalData !== clearLocalData
    || pending.expectedProviderSubjects.join(",") !== sortedProviderSubjects.join(","))) {
    return deletionFailure("A previous account deletion is still pending on this device. Restart Riento to resume it before deleting another identity.", "processing");
  }

  if (!pending) {
    const googleSubjectEntry = sortedProviderSubjects.find((subject) => subject.startsWith("google:"));
    pending = {
      clearLocalData,
      expectedProviderSubjects: sortedProviderSubjects,
      expectedUserId,
      googleRevocationStatus: googleSubjectEntry ? "pending" : "not_needed",
      googleSubject: googleSubjectEntry?.slice("google:".length) ?? null,
      operationToken: await createDeletionOperationToken(),
      requireAnonymous,
      version: 1
    };

    try {
      await savePendingDeviceDataDeletion(pending);
    } catch {
      return deletionFailure("Could not save the deletion recovery key on this device, so no server data was deleted.", "not_started");
    }
  }

  return invokePendingDeviceDataDeletion(pending, appleAuthorizationCode, appleNonce);
}

export async function resumePendingDeviceDataDeletion() {
  const pending = await getPendingDeviceDataDeletion();

  if (!pending) {
    return null;
  }

  if (!supabase) {
    return deletionFailure("Riento services are not configured.", "processing");
  }

  return invokePendingDeviceDataDeletion(pending);
}

export async function getPendingDeviceDataDeletion(): Promise<PendingDeviceDataDeletion | null> {
  const storedValue = await authStateStorage.getItem(pendingDeviceDeletionKey);

  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);
    if (!isPendingDeviceDataDeletion(parsedValue)) {
      throw new Error("The saved deletion recovery state is invalid.");
    }

    return parsedValue;
  } catch {
    throw new Error("The saved deletion recovery state is unreadable. Reset the unavailable session only if you accept that an in-progress server deletion may no longer be recoverable from this device.");
  }
}

export async function updatePendingGoogleRevocationStatus(status: PendingDeviceDataDeletion["googleRevocationStatus"]) {
  const pending = await getPendingDeviceDataDeletion();

  if (!pending) {
    return;
  }

  await savePendingDeviceDataDeletion({ ...pending, googleRevocationStatus: status });
}

export async function clearPendingDeviceDataDeletion() {
  await authStateStorage.removeItem(pendingDeviceDeletionKey);
}

export async function clearPendingDeletionLocalData(pending: PendingDeviceDataDeletion) {
  if (!pending.clearLocalData) {
    return;
  }

  await Promise.all([
    clearSavedVenues(),
    resetProfileSettings(),
    resetMusicRecognitionSettings()
  ]);
}

async function invokePendingDeviceDataDeletion(
  pending: PendingDeviceDataDeletion,
  appleAuthorizationCode?: string,
  appleNonce?: string
) {
  if (!supabase) {
    return deletionFailure("Riento services are not configured.", "processing");
  }

  let invocationResult;

  try {
    invocationResult = await withTimeout(supabase.functions.invoke("delete-device-data", {
      body: {
        confirmation: "DELETE_DEVICE_DATA",
        expectedProviderSubjects: pending.expectedProviderSubjects,
        expectedUserId: pending.expectedUserId,
        operationToken: pending.operationToken,
        requireAnonymous: pending.requireAnonymous,
        appleAuthorizationCode,
        appleNonce
      }
    }), 15_000);
  } catch {
    return deletionFailure("Deletion status could not be confirmed. Retry to resume the same deletion safely.", "processing");
  }

  const { data, error } = invocationResult;

  if (error) {
    const context = (error as { context?: Response }).context;
    let responseBody: Record<string, unknown> | null = null;

    if (context) {
      try {
        responseBody = await context.json();
      } catch {
        // A lost or unreadable response must keep the recovery token for a retry.
      }
    }

    if (context && [400, 401, 409].includes(context.status) && responseBody?.state !== "processing") {
      await clearPendingDeviceDataDeletion();
      return deletionFailure(
        typeof responseBody?.message === "string" ? responseBody.message : error.message,
        "not_started"
      );
    }

    return deletionFailure(
      typeof responseBody?.message === "string"
        ? responseBody.message
        : "Deletion status could not be confirmed. Retry to resume the same deletion safely.",
      "processing"
    );
  }

  if (data?.state !== "completed" || data?.ok !== true) {
    return deletionFailure(data?.message ?? "Riento data deletion is still processing. Retry shortly.", "processing");
  }

  const providerRevocation = isProviderRevocation(data.providerRevocation) ? data.providerRevocation : undefined;
  await savePendingDeviceDataDeletion({ ...pending, providerRevocation });

  return {
    ok: true as const,
    providerRevocation,
    serverDeleted: true,
    state: "completed" as const,
    message: data.message ?? "Riento data deleted."
  };
}

export async function clearReviewAuthorBlocks() {
  if (!supabase) {
    return { ok: false, message: "Riento services are not configured." };
  }

  const { data, error } = await supabase.rpc("clear_review_author_blocks");

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: data?.ok === true, message: data?.message ?? "Blocked reviewers were cleared." };
}

function isProfileSettings(value: unknown): value is ProfileSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<ProfileSettings>;
  return typeof settings.gpsOnMapOpen === "boolean" && typeof settings.manualPlacementEnabled === "boolean";
}

function isProviderRevocation(value: unknown): value is "failed" | "not_needed" | "succeeded" {
  return value === "failed" || value === "not_needed" || value === "succeeded";
}

function deletionFailure(message: string, state: "not_started" | "processing") {
  return { message, ok: false as const, serverDeleted: false, state };
}

async function createDeletionOperationToken() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function savePendingDeviceDataDeletion(pending: PendingDeviceDataDeletion) {
  await authStateStorage.setItem(pendingDeviceDeletionKey, JSON.stringify(pending));
}

function isPendingDeviceDataDeletion(value: unknown): value is PendingDeviceDataDeletion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pending = value as Partial<PendingDeviceDataDeletion>;
  return pending.version === 1
    && typeof pending.clearLocalData === "boolean"
    && Array.isArray(pending.expectedProviderSubjects)
    && pending.expectedProviderSubjects.every((subject) => typeof subject === "string")
    && typeof pending.expectedUserId === "string"
    && (pending.googleRevocationStatus === "failed"
      || pending.googleRevocationStatus === "not_needed"
      || pending.googleRevocationStatus === "pending"
      || pending.googleRevocationStatus === "succeeded")
    && (pending.googleSubject === null || typeof pending.googleSubject === "string")
    && typeof pending.operationToken === "string"
    && /^[0-9a-f]{64}$/.test(pending.operationToken)
    && typeof pending.requireAnonymous === "boolean"
    && (pending.providerRevocation === undefined || isProviderRevocation(pending.providerRevocation));
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Operation timed out.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
