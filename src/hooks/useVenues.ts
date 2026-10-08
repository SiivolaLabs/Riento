import { useCallback, useEffect, useState } from "react";

import { getVenueList, getVenueListSnapshot, startVenueListPolling, subscribeToVenueList, VenueListRequestOptions, VenueSource } from "../services/venueService";
import { Venue } from "../types/venue";

type VenueState = {
  error: string | null;
  isLoading: boolean;
  source: VenueSource;
  venues: Venue[];
  warning: string | null;
};

export function useVenues() {
  const [state, setState] = useState<VenueState>(() => mapVenueState(getVenueListSnapshot()));

  const refresh = useCallback(async (options?: VenueListRequestOptions) => {
    setState((current) => ({ ...current, error: null }));

    try {
      return await getVenueList(options);
    } catch {
      setState((current) => ({
        ...current,
        error: "Venue data could not be refreshed.",
        isLoading: false
      }));

      return null;
    }
  }, []);

  useEffect(() => {
    const syncSnapshot = () => {
      setState(mapVenueState(getVenueListSnapshot()));
    };
    const unsubscribe = subscribeToVenueList(syncSnapshot);
    syncSnapshot();
    const stopPolling = startVenueListPolling();
    void refresh();

    return () => {
      stopPolling();
      unsubscribe();
    };
  }, [refresh]);

  return { ...state, refresh };
}

function mapVenueState(result: ReturnType<typeof getVenueListSnapshot>): VenueState {
  return { error: null, isLoading: result.isLoading, source: result.source, venues: result.venues, warning: result.warning };
}
