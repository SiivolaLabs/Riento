import { supabase } from "../lib/supabase";
import { type CrowdLevel } from "../types/venue";

type AdminMutationResult = {
  message?: string;
  ok?: boolean;
};

export async function featureVenueOnTrending(venueId: string, sortRank: number) {
  if (!supabase) {
    return { ok: false, message: "Riento services are not configured." };
  }

  const { data, error } = await supabase.rpc("set_curated_trending_venue", {
    p_duration_hours: 12,
    p_headline: null,
    p_sort_rank: Math.max(1, Math.min(999, Math.round(sortRank))),
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapAdminResult(data, "Venue added to Trending.");
}

export async function removeVenueFromTrending(venueId: string) {
  if (!supabase) {
    return { ok: false, message: "Riento services are not configured." };
  }

  const { data, error } = await supabase.rpc("remove_curated_trending_venue", {
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapAdminResult(data, "Featured placement removed. Current activity may still keep this venue on Trending.");
}

export async function submitAdminVenueSignal(venueId: string, crowdLevel: CrowdLevel, durationMinutes = 90) {
  if (!supabase) {
    return { ok: false, message: "Riento services are not configured." };
  }

  const { data, error } = await supabase.rpc("submit_admin_venue_signal", {
    p_crowd_level: crowdLevel,
    p_duration_minutes: Math.max(15, Math.min(240, Math.round(durationMinutes))),
    p_note: null,
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapAdminResult(data, "Temporary activity estimate published.");
}

export async function setAdminVenueNowPlaying(venueId: string, trackTitle: string, artistName: string) {
  if (!supabase) {
    return { ok: false, message: "Riento services are not configured." };
  }

  const normalizedTitle = trackTitle.trim();
  const normalizedArtist = artistName.trim();

  if (normalizedTitle.length === 0) {
    return { ok: false, message: "Track title is required." };
  }

  const { data, error } = await supabase.rpc("set_admin_venue_now_playing", {
    p_artist_name: normalizedArtist.length > 0 ? normalizedArtist : null,
    p_track_title: normalizedTitle,
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapAdminResult(data, "Trusted now-playing entry published for 45 minutes.");
}

function mapAdminResult(data: unknown, fallbackMessage: string) {
  const result = data as AdminMutationResult | null;

  return {
    ok: result?.ok === true,
    message: result?.message ?? fallbackMessage
  };
}
