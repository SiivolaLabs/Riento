import { useCallback, useEffect, useState } from "react";

import {
  defaultMusicRecognitionSettings,
  getMusicRecognitionSettings,
  MusicRecognitionSettings,
  resetMusicRecognitionSettings,
  saveMusicRecognitionSettings,
  subscribeToMusicRecognitionSettings,
  unavailableMusicRecognitionSettings
} from "../services/musicRecognitionSettingsService";

export function useMusicRecognitionSettings() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<MusicRecognitionSettings>(defaultMusicRecognitionSettings);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToMusicRecognitionSettings(setSettings);

    getMusicRecognitionSettings()
      .then((nextSettings) => {
        if (active) {
          setSettings(nextSettings);
          setIsLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setSettings(unavailableMusicRecognitionSettings);
          setError(loadError instanceof Error ? loadError.message : "Could not load music recognition settings.");
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateSettings = useCallback(async (nextSettings: MusicRecognitionSettings) => {
    setSettings(nextSettings);

    try {
      await saveMusicRecognitionSettings(nextSettings);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save music recognition settings.");
    }
  }, []);

  const resetSettings = useCallback(async () => {
    await resetMusicRecognitionSettings();
    setSettings(defaultMusicRecognitionSettings);
    setError(null);
  }, []);

  return {
    error,
    isLoading,
    resetSettings,
    settings,
    setPromptEnabled: (value: boolean) => updateSettings({ ...settings, promptEnabled: value })
  };
}
