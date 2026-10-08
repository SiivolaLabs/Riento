import { useCallback, useEffect, useState } from "react";

import { defaultProfileSettings, getProfileSettings, ProfileSettings, resetProfileSettings, saveProfileSettings, subscribeToProfileSettings, unavailableProfileSettings } from "../services/profileService";

export function useProfileSettings() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<ProfileSettings>(defaultProfileSettings);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToProfileSettings(setSettings);

    getProfileSettings()
      .then((nextSettings) => {
        if (active) {
          setSettings(nextSettings);
          setIsLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setSettings(unavailableProfileSettings);
          setError(loadError instanceof Error ? loadError.message : "Could not load settings.");
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const updateSettings = useCallback(async (nextSettings: ProfileSettings) => {
    setSettings(nextSettings);

    try {
      await saveProfileSettings(nextSettings);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    }
  }, []);

  const resetSettings = useCallback(async () => {
    await resetProfileSettings();
    setSettings(defaultProfileSettings);
    setError(null);
  }, []);

  return {
    error,
    isLoading,
    resetSettings,
    settings,
    setGpsOnMapOpen: (value: boolean) => updateSettings({ ...settings, gpsOnMapOpen: value }),
    setManualPlacementEnabled: (value: boolean) => updateSettings({ ...settings, manualPlacementEnabled: value })
  };
}
