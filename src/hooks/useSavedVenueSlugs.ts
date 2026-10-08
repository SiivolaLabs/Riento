import { useCallback, useEffect, useState } from "react";

import { clearSavedVenues, getSavedVenueSlugs, setVenueSaved, subscribeToSavedVenues } from "../services/savedVenueService";

export function useSavedVenueSlugs() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savedVenueSlugs, setSavedVenueSlugs] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const slugs = await getSavedVenueSlugs();
      setSavedVenueSlugs(slugs);
      return slugs;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load My spots.");
      return new Set<string>();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToSavedVenues(setSavedVenueSlugs);
    refresh();
    return unsubscribe;
  }, [refresh]);

  const setSaved = useCallback(async (slug: string, isSaved: boolean) => {
    try {
      setError(null);
      return await setVenueSaved(slug, isSaved);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not update My spots.";
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const clearSaved = useCallback(async () => {
    await clearSavedVenues();
  }, []);

  return { clearSaved, error, isLoading, refresh, savedVenueSlugs, setSaved };
}
