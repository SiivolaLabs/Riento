import { authStateStorage } from "../lib/supabase";

export type MusicRecognitionSettings = {
  promptEnabled: boolean;
};

const musicRecognitionSettingsKey = "mesta.musicRecognitionSettings.v1";
const listeners = new Set<(settings: MusicRecognitionSettings) => void>();
let musicRecognitionSettingsUnavailable = false;

export const defaultMusicRecognitionSettings: MusicRecognitionSettings = {
  promptEnabled: true
};

export const unavailableMusicRecognitionSettings: MusicRecognitionSettings = {
  promptEnabled: false
};

export async function getMusicRecognitionSettings(): Promise<MusicRecognitionSettings> {
  if (musicRecognitionSettingsUnavailable) {
    throw new Error("Saved music recognition settings are unavailable in this app session.");
  }

  const value = await authStateStorage.getItem(musicRecognitionSettingsKey);

  if (!value) {
    return defaultMusicRecognitionSettings;
  }

  try {
    const parsedValue = JSON.parse(value) as Partial<MusicRecognitionSettings>;

    if (typeof parsedValue.promptEnabled !== "boolean") {
      throw new Error("Saved music recognition settings are invalid.");
    }

    return { promptEnabled: parsedValue.promptEnabled };
  } catch {
    throw new Error("Saved music recognition settings could not be read.");
  }
}

export async function saveMusicRecognitionSettings(settings: MusicRecognitionSettings) {
  try {
    await authStateStorage.setItem(musicRecognitionSettingsKey, JSON.stringify(settings));
  } catch (error) {
    musicRecognitionSettingsUnavailable = true;
    listeners.forEach((listener) => listener(unavailableMusicRecognitionSettings));
    throw error;
  }

  musicRecognitionSettingsUnavailable = false;
  listeners.forEach((listener) => listener(settings));
}

export async function resetMusicRecognitionSettings() {
  try {
    await authStateStorage.removeItem(musicRecognitionSettingsKey);
  } catch (error) {
    musicRecognitionSettingsUnavailable = true;
    listeners.forEach((listener) => listener(unavailableMusicRecognitionSettings));
    throw error;
  }

  musicRecognitionSettingsUnavailable = false;
  listeners.forEach((listener) => listener(defaultMusicRecognitionSettings));
}

export function subscribeToMusicRecognitionSettings(listener: (settings: MusicRecognitionSettings) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
