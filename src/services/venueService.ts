import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";

import { venues as localVenues } from "../data/venues";
import { getCrowdLevelScore } from "../lib/crowd";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { deriveVenueSoundTags, getVenueOpenStateLabel } from "../lib/venueDiscovery";
import { CrowdLevel, CrowdTrend, Venue, VenueDataSource, VenueKind, VenueMusicHistory, VenueNowPlayingSource, VenueOpeningHours, VenueRating, VenueSoundTag, VenueVerificationStatus, VenueWeekday, VenueWeeklyOpeningHours } from "../types/venue";

export type VenueMusicReportSource = Extract<VenueNowPlayingSource, "user_confirmation">;

export type VenueSource = "local" | "supabase";

export type VenueReportReason = "closed" | "duplicate" | "missing_venue" | "other" | "wrong_address" | "wrong_crowd" | "wrong_hours" | "wrong_music";
export type ReviewReportReason = "abusive" | "false_information" | "harassment" | "other" | "personal_information" | "safety_threat" | "spam";

export type VenueResult = {
  source: VenueSource;
  venues: Venue[];
  warning: string | null;
};

export type VenueListSnapshot = VenueResult & {
  isLoading: boolean;
};

export type VenueListRequestOptions = {
  force?: boolean;
};

type VenueRow = {
  address: string;
  capacity_estimate: number | null;
  id: string;
  kind: VenueKind;
  latitude: number;
  longitude: number;
  name: string;
  neighborhood: string;
  opening_hours: Record<string, unknown> | null;
  slug: string;
  sound_tags: string[] | null;
  source: VenueDataSource;
  source_checked_at: string | null;
  source_external_id: string | null;
  verification_status: VenueVerificationStatus;
  vibe: string | null;
};

type CrowdSnapshotRow = {
  created_at: string;
  crowd_level: CrowdLevel;
  has_signal: boolean;
  id: string;
  snapshot_rank: number;
  venue_id: string;
};

type VenueNowPlayingRow = {
  artist_name: string | null;
  track_title: string;
  venue_id: string;
};

type VenueMusicHistoryRow = {
  artist_name: string | null;
  genre: string | null;
  item_rank: number;
  item_type: "genre" | "track";
  period_name: "daily" | "monthly";
  track_title: string | null;
};

type VenueRatingSummaryRow = {
  average_rating: number | string | null;
  review_count: number | null;
  venue_id: string;
};

type PublicVenueRatingRow = {
  comment: string | null;
  id: string;
  is_own: boolean;
  moderation_status: "approved" | "pending" | "rejected" | null;
  rating: number;
  updated_at: string;
  venue_id: string;
};

type CuratedTrendingVenueRow = {
  expires_at: string;
  headline: string | null;
  sort_rank: number;
  venue_id: string;
};

type PublicVenueEnrichments = {
  crowd_snapshots: CrowdSnapshotRow[];
  now_playing: VenueNowPlayingRow[];
  rating_summaries: VenueRatingSummaryRow[];
  trending_venues: CuratedTrendingVenueRow[];
};

type SubmitVenueMusicReportResult = {
  message?: string;
  ok?: boolean;
  report_id?: string;
};

type SubmitJsonResult = {
  message?: string;
  ok?: boolean;
};

export const emptyVenueMusicHistory: VenueMusicHistory = {
  daily: { genres: [], tracks: [] },
  monthly: { genres: [], tracks: [] }
};

const validVenueSoundTags = new Set<VenueSoundTag>(["dance-pop", "electronic", "jazz", "karaoke", "live-music", "mixed", "rock", "unknown"]);
const venueListFreshMs = 30_000;
const venueListMaxStaleMs = 5 * 60_000;
const venueListPollMs = 2 * 60_000;
const venueListMaxPollMs = 8 * 60_000;
const venueRowsFreshMs = 5 * 60_000;
const venueRowsMaxStaleMs = 25 * 60_000;
const provisionalVenueListSnapshot: VenueListSnapshot = {
  isLoading: isSupabaseConfigured,
  source: "local",
  venues: localVenues,
  warning: isSupabaseConfigured
    ? "Loading live venues. Showing provisional local venue data."
    : "Showing provisional local venue data."
};

let pendingVenueListRequest: Promise<VenueResult> | null = null;
let trailingVenueListRequest: Promise<VenueResult> | null = null;
let venueListCache: { completedAt: number; result: VenueResult } | null = null;
let venueRowsCache: { completedAt: number; rows: VenueRow[] } | null = null;
let venueListAppState: AppStateStatus = AppState.currentState;
let venueListAppStateSubscription: NativeEventSubscription | null = null;
let venueListPollFailureCount = 0;
let venueListPollLeaseCount = 0;
let venueListPollTimer: ReturnType<typeof setTimeout> | null = null;
let venueListMutationVersion = 0;
const venueListListeners = new Set<() => void>();
const crowdOverrides = new Map<string, { crowdLevel: CrowdLevel; hasSignal: boolean; version: number }>();

export function getVenueList(options: VenueListRequestOptions = {}): Promise<VenueResult> {
  if (options.force) {
    if (!pendingVenueListRequest) {
      return startVenueListRequest();
    }

    if (!trailingVenueListRequest) {
      trailingVenueListRequest = pendingVenueListRequest
        .catch(() => undefined)
        .then(() => startVenueListRequest())
        .finally(() => {
          trailingVenueListRequest = null;
        });
    }

    return trailingVenueListRequest;
  }

  if (venueListCache) {
    if (Date.now() - venueListCache.completedAt >= venueListFreshMs && !pendingVenueListRequest) {
      void startVenueListRequest();
    }

    return Promise.resolve(venueListCache.result);
  }

  return pendingVenueListRequest ?? startVenueListRequest();
}

export function getVenueListSnapshot(): VenueListSnapshot {
  return venueListCache
    ? { ...venueListCache.result, isLoading: false }
    : provisionalVenueListSnapshot;
}

export function subscribeToVenueList(listener: () => void) {
  venueListListeners.add(listener);

  return () => {
    venueListListeners.delete(listener);
  };
}

export function startVenueListPolling() {
  venueListPollLeaseCount += 1;

  if (venueListPollLeaseCount === 1) {
    venueListAppState = AppState.currentState;
    venueListAppStateSubscription = AppState.addEventListener("change", handleVenueListAppStateChange);

    if (venueListAppState === "active") {
      scheduleVenueListPoll();
    }
  }

  return () => {
    venueListPollLeaseCount = Math.max(0, venueListPollLeaseCount - 1);

    if (venueListPollLeaseCount === 0) {
      clearVenueListPollTimer();
      venueListAppStateSubscription?.remove();
      venueListAppStateSubscription = null;
    }
  };
}

function handleVenueListAppStateChange(nextState: AppStateStatus) {
  const previousState = venueListAppState;
  venueListAppState = nextState;

  if (nextState !== "active") {
    clearVenueListPollTimer();
    return;
  }

  if (previousState === "active" || venueListPollLeaseCount === 0) {
    return;
  }

  const cacheAgeMs = venueListCache ? Date.now() - venueListCache.completedAt : Number.POSITIVE_INFINITY;

  if (cacheAgeMs >= venueListFreshMs) {
    void getVenueList({ force: true })
      .then(updateVenueListPollFailureCount)
      .catch(() => updateVenueListPollFailureCount(null))
      .finally(() => {
        clearVenueListPollTimer();
        scheduleVenueListPoll();
      });
  } else {
    scheduleVenueListPoll();
  }
}

function clearVenueListPollTimer() {
  if (venueListPollTimer) {
    clearTimeout(venueListPollTimer);
    venueListPollTimer = null;
  }
}

function startVenueListRequest() {
  if (pendingVenueListRequest) {
    return pendingVenueListRequest;
  }

  const requestMutationVersion = venueListMutationVersion;
  pendingVenueListRequest = loadVenueList()
    .then((loadedResult) => publishLoadedVenueList(loadedResult, requestMutationVersion))
    .finally(() => {
      pendingVenueListRequest = null;
    });

  return pendingVenueListRequest;
}

function publishLoadedVenueList(loadedResult: VenueResult, requestMutationVersion: number) {
  const now = Date.now();
  const previousCache = venueListCache;

  if (loadedResult.source === "local"
    && previousCache?.result.source === "supabase"
    && now - previousCache.completedAt < venueListMaxStaleMs) {
    venueListCache = {
      completedAt: previousCache.completedAt,
      result: {
        ...previousCache.result,
        warning: loadedResult.warning ?? "Live venues could not be refreshed. Showing recent venue data."
      }
    };
  } else {
    venueListCache = {
      completedAt: now,
      result: loadedResult.source === "supabase"
        ? applyCrowdOverrides(loadedResult, requestMutationVersion)
        : loadedResult
    };
  }

  notifyVenueListListeners();
  return venueListCache.result;
}

function applyCrowdOverrides(result: VenueResult, requestMutationVersion: number) {
  for (const [venueId, override] of crowdOverrides) {
    if (override.version <= requestMutationVersion) {
      crowdOverrides.delete(venueId);
    }
  }

  if (crowdOverrides.size === 0) {
    return result;
  }

  return {
    ...result,
    venues: result.venues.map((venue) => {
      const override = crowdOverrides.get(venue.id);

      return override ? withCrowdLevel(venue, override.crowdLevel, override.hasSignal) : venue;
    })
  };
}

function scheduleVenueListPoll() {
  if (venueListPollLeaseCount === 0 || venueListAppState !== "active" || venueListPollTimer || !isSupabaseConfigured) {
    return;
  }

  const backoffMs = Math.min(venueListPollMs * (2 ** venueListPollFailureCount), venueListMaxPollMs);
  const jitteredDelayMs = Math.round(backoffMs * (0.8 + Math.random() * 0.4));

  venueListPollTimer = setTimeout(async () => {
    venueListPollTimer = null;

    try {
      const result = await getVenueList({ force: true });
      updateVenueListPollFailureCount(result);
    } catch {
      updateVenueListPollFailureCount(null);
    } finally {
      scheduleVenueListPoll();
    }
  }, jitteredDelayMs);
}

function updateVenueListPollFailureCount(result: VenueResult | null) {
  venueListPollFailureCount = result?.source === "supabase" && !result.warning
    ? 0
    : Math.min(venueListPollFailureCount + 1, 2);
}

function notifyVenueListListeners() {
  for (const listener of venueListListeners) {
    listener();
  }
}

async function loadVenueList(): Promise<VenueResult> {
  if (!isSupabaseConfigured || !supabase) {
    return getLocalVenueResult("Showing provisional local venue data.");
  }

  const supabaseClient = supabase;
  const venueRowsResult = await loadVenueRows(supabaseClient);
  const venueRows = venueRowsResult.data;

  if (!venueRows?.length) {
    return getLocalVenueResult("Live venues are unavailable. Showing provisional local venue data.");
  }

  const venueIds = new Set(venueRows.map((venue) => venue.id));
  const enrichmentResult = await loadEnrichment(async () => {
    const { data, error } = await supabaseClient
      .from("public_venue_enrichment_cache")
      .select("payload")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const bundle = parsePublicVenueEnrichments(data?.payload);
    if (!bundle) {
      throw new Error("Public venue enrichment RPC returned a malformed bundle.");
    }

    return bundle;
  }, {
    crowd_snapshots: [],
    now_playing: [],
    rating_summaries: [],
    trending_venues: []
  } as PublicVenueEnrichments);
  const snapshotResult = { data: enrichmentResult.data.crowd_snapshots, failed: enrichmentResult.failed };
  const nowPlayingResult = { data: enrichmentResult.data.now_playing, failed: enrichmentResult.failed };
  const ratingSummaryResult = { data: enrichmentResult.data.rating_summaries, failed: enrichmentResult.failed };
  const trendingResult = { data: enrichmentResult.data.trending_venues, failed: enrichmentResult.failed };

  const snapshotsByVenue = new Map<string, CrowdSnapshotRow[]>();

  for (const snapshot of snapshotResult.data) {
    if (venueIds.has(snapshot.venue_id)) {
      const venueSnapshots = snapshotsByVenue.get(snapshot.venue_id) ?? [];
      venueSnapshots.push(snapshot);
      snapshotsByVenue.set(snapshot.venue_id, venueSnapshots);
    }
  }

  for (const venueSnapshots of snapshotsByVenue.values()) {
    venueSnapshots.sort((left, right) => left.snapshot_rank - right.snapshot_rank);
  }

  const nowPlayingByVenue = new Map<string, VenueNowPlayingRow>();

  for (const nowPlaying of nowPlayingResult.data) {
    if (venueIds.has(nowPlaying.venue_id) && !nowPlayingByVenue.has(nowPlaying.venue_id)) {
      nowPlayingByVenue.set(nowPlaying.venue_id, nowPlaying);
    }
  }

  const ratingSummaryByVenue = new Map<string, VenueRatingSummaryRow>();
  const trendingByVenue = new Map<string, CuratedTrendingVenueRow>();

  for (const ratingSummary of ratingSummaryResult.data) {
    if (venueIds.has(ratingSummary.venue_id)) {
      ratingSummaryByVenue.set(ratingSummary.venue_id, ratingSummary);
    }
  }

  for (const trending of trendingResult.data) {
    if (venueIds.has(trending.venue_id)) {
      trendingByVenue.set(trending.venue_id, trending);
    }
  }

  const previousVenuesBySlug = venueListCache?.result.source === "supabase"
    ? new Map(venueListCache.result.venues.map((venue) => [venue.slug, venue]))
    : null;

  return {
    source: "supabase",
    venues: venueRows.map((venue) => {
      const venueSnapshots = snapshotsByVenue.get(venue.id) ?? [];
      const previousVenue = previousVenuesBySlug?.get(venue.slug);
      const mappedVenue = mapVenueRow(venue, venueSnapshots[0], venueSnapshots[1], nowPlayingByVenue.get(venue.id), ratingSummaryByVenue.get(venue.id), trendingByVenue.get(venue.id));

      return previousVenue ? preserveFailedVenueEnrichments(mappedVenue, previousVenue, {
        crowd: snapshotResult.failed,
        nowPlaying: nowPlayingResult.failed,
        ratings: ratingSummaryResult.failed,
        trending: trendingResult.failed
      }) : mappedVenue;
    }),
    warning: venueRowsResult.failed || snapshotResult.failed || nowPlayingResult.failed || ratingSummaryResult.failed || trendingResult.failed
      ? "Some live venue details could not be loaded."
      : null
  };
}

async function loadVenueRows(supabaseClient: NonNullable<typeof supabase>) {
  const startedAt = Date.now();

  if (venueRowsCache && startedAt - venueRowsCache.completedAt < venueRowsFreshMs) {
    return { data: venueRowsCache.rows, failed: false };
  }

  try {
    const { data, error } = await supabaseClient
      .from("venues")
      .select("id,slug,name,kind,address,neighborhood,latitude,longitude,capacity_estimate,source,source_external_id,source_checked_at,verification_status,opening_hours,vibe,sound_tags")
      .in("verification_status", ["needs_verification", "verified"])
      .order("name", { ascending: true });

    if (!error && data?.length) {
      const rows = data as VenueRow[];
      venueRowsCache = { completedAt: Date.now(), rows };
      return { data: rows, failed: false };
    }
  } catch {
    // A recent base-row snapshot can still support fresh volatile enrichments.
  }

  if (venueRowsCache && Date.now() - venueRowsCache.completedAt < venueRowsMaxStaleMs) {
    return { data: venueRowsCache.rows, failed: true };
  }

  return { data: null, failed: true };
}

function preserveFailedVenueEnrichments(
  venue: Venue,
  previousVenue: Venue,
  failed: { crowd: boolean; nowPlaying: boolean; ratings: boolean; trending: boolean }
): Venue {
  return {
    ...venue,
    ...(failed.crowd ? {
      crowdLevel: previousVenue.crowdLevel,
      crowdTrend: previousVenue.crowdTrend,
      hasLiveCrowdSignal: previousVenue.hasLiveCrowdSignal,
      lastUpdated: previousVenue.lastUpdated,
      mockActivityScore: previousVenue.mockActivityScore
    } : {}),
    ...(failed.nowPlaying ? { nowPlaying: previousVenue.nowPlaying } : {}),
    ...(failed.ratings ? {
      averageRating: previousVenue.averageRating,
      ratingCount: previousVenue.ratingCount
    } : {}),
    ...(failed.trending ? {
      trendingHeadline: previousVenue.trendingHeadline,
      trendingRank: previousVenue.trendingRank
    } : {})
  };
}

export async function getVenueRatings(venueId: string): Promise<VenueRating[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("get_public_venue_reviews", {
    p_limit: 20,
    p_venue_id: venueId
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load ratings.");
  }

  return (data as PublicVenueRatingRow[]).map(mapVenueRatingRow);
}

export async function submitVenueRating(venueId: string, rating: number, comment?: string) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const normalizedRating = Math.round(rating);
  const normalizedComment = comment?.trim() || null;

  if (normalizedRating < 1 || normalizedRating > 5) {
    return { ok: false, message: "Choose a rating from 1 to 5." };
  }

  if (normalizedComment && (normalizedComment.length < 10 || normalizedComment.length > 700)) {
    return { ok: false, message: "Written reviews must be between 10 and 700 characters." };
  }

  try {
    const { data, error } = await supabase.rpc("submit_venue_review", {
      p_comment: normalizedComment,
      p_rating: normalizedRating,
      p_venue_id: venueId
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return mapSubmitJsonResult(data, "Rating saved.");
  } catch (error) {
    return { ok: false, message: formatSupabaseNetworkFailure(error, "Could not save the rating") };
  }
}

export async function acceptReviewTerms() {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("accept_review_terms", { p_terms_version: "2026-07-23" });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapSubmitJsonResult(data, "Review terms accepted.");
}

export async function submitReviewReport(reviewId: string, reason: ReviewReportReason) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("submit_review_report", {
    p_details: null,
    p_reason: reason,
    p_review_id: reviewId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapSubmitJsonResult(data, "Review reported for moderation.");
}

export async function blockReviewAuthor(reviewId: string) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("block_review_author", { p_review_id: reviewId });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapSubmitJsonResult(data, "Reviewer blocked on this account or device session.");
}

export async function submitVenuePing(venueId: string, confidence = 1) {
  return submitVenueSignal(venueId, "gps", confidence);
}

export async function submitManualCheckin(venueId: string) {
  return submitVenueSignal(venueId, "manual", 1);
}

export async function submitVenueReport(venueId: string, reason: VenueReportReason, details: string) {
  return insertVenueReport(venueId, reason, details, "Report sent. Thanks for helping verify Helsinki venues.");
}

export async function submitMissingVenueReport(details: string) {
  return insertVenueReport(null, "missing_venue", details, "Missing venue report sent. Thanks for improving Riento coverage.");
}

export async function submitNowPlayingConfirmation(venueId: string, title: string, artistName: string, reportSource: VenueMusicReportSource = "user_confirmation") {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const trimmedTitle = title.trim();
  const trimmedArtistName = artistName.trim();

  if (trimmedTitle.length === 0) {
    return { ok: false, message: "Add the track title before sending." };
  }

  try {
    const { data, error } = await supabase.rpc("submit_venue_music_report", {
      p_artist_name: trimmedArtistName.length > 0 ? trimmedArtistName : null,
      p_report_source: reportSource,
      p_track_title: trimmedTitle,
      p_venue_id: venueId
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    const result = data as SubmitVenueMusicReportResult | null;

    if (!result?.ok) {
      return { ok: false, message: result?.message ?? "Could not publish the now-playing signal." };
    }

    return {
      ok: true,
      message: result?.message ?? "Now-playing signal published for this venue."
    };
  } catch (error) {
    return { ok: false, message: formatSupabaseNetworkFailure(error, "Could not send the now-playing signal") };
  }
}

export async function submitMusicMatchFeedback(venueId: string, title: string, artistName: string, isCorrect: boolean) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const trimmedTitle = title.trim();
  const trimmedArtistName = artistName.trim();

  if (trimmedTitle.length === 0) {
    return { ok: false, message: "A detected track is required before sending feedback." };
  }

  try {
    const { data, error } = await supabase.rpc("submit_music_match_feedback", {
      p_artist_name: trimmedArtistName.length > 0 ? trimmedArtistName : null,
      p_is_correct: isCorrect,
      p_track_title: trimmedTitle,
      p_venue_id: venueId
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return mapSubmitJsonResult(data, "Thanks for improving Riento's venue and music accuracy.");
  } catch (error) {
    return { ok: false, message: formatSupabaseNetworkFailure(error, "Could not send music feedback") };
  }
}

export async function getVenueMusicHistory(venueId: string): Promise<VenueMusicHistory> {
  if (!supabase) {
    return emptyVenueMusicHistory;
  }

  const { data, error } = await supabase.rpc("get_public_venue_music_history", {
    p_venue_id: venueId
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load music history.");
  }

  const rows = data as VenueMusicHistoryRow[];

  return {
    daily: mapMusicHistoryPeriod(rows.filter((row) => row.period_name === "daily")),
    monthly: mapMusicHistoryPeriod(rows.filter((row) => row.period_name === "monthly"))
  };
}

async function insertVenueReport(venueId: string | null, reason: VenueReportReason, details: string, successMessage: string) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const trimmedDetails = details.trim();
  const { data, error } = await supabase.rpc("submit_venue_report", {
    p_details: trimmedDetails.length > 0 ? trimmedDetails : null,
    p_reason: reason,
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return mapSubmitJsonResult(data, successMessage);
}

async function submitVenueSignal(venueId: string, source: "gps" | "manual", confidence: number) {
  if (!supabase) {
    return { ok: false, message: "Supabase is not configured." };
  }

  const { data, error } = await supabase.rpc("submit_venue_signal", {
    p_confidence: confidence,
    p_source: source,
    p_venue_id: venueId
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const result = data as { crowd_level?: CrowdLevel; has_signal?: boolean; message?: string; ok?: boolean } | null;

  if (result?.ok && result.crowd_level && venueListCache?.result.source === "supabase") {
    venueListMutationVersion += 1;
    crowdOverrides.set(venueId, {
      crowdLevel: result.crowd_level,
      hasSignal: result.has_signal === true,
      version: venueListMutationVersion
    });
    venueListCache = {
      ...venueListCache,
      result: {
        ...venueListCache.result,
        venues: venueListCache.result.venues.map((venue) => venue.id === venueId
          ? withCrowdLevel(venue, result.crowd_level as CrowdLevel, result.has_signal === true)
          : venue)
      }
    };
    notifyVenueListListeners();
  }

  return {
    crowdLevel: result?.crowd_level,
    hasSignal: result?.has_signal === true,
    ok: Boolean(result?.ok),
    message: result?.message ?? "Signal submitted."
  };
}

function withCrowdLevel(venue: Venue, crowdLevel: CrowdLevel, hasLiveCrowdSignal = true): Venue {
  return {
    ...venue,
    crowdLevel,
    crowdTrend: undefined,
    hasLiveCrowdSignal,
    lastUpdated: hasLiveCrowdSignal ? "Recent live signal" : "No current public signal",
    mockActivityScore: hasLiveCrowdSignal ? getCrowdLevelScore(crowdLevel) : 0
  };
}

function formatSupabaseNetworkFailure(error: unknown, action: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown network error";

  return `${action}. Check the device internet connection and try again. Supabase error: ${message}`;
}

function mapVenueRow(
  venue: VenueRow,
  snapshot?: CrowdSnapshotRow,
  previousSnapshot?: CrowdSnapshotRow,
  nowPlaying?: VenueNowPlayingRow,
  ratingSummary?: VenueRatingSummaryRow,
  trending?: CuratedTrendingVenueRow
): Venue {
  const hasLiveCrowdSignal = snapshot?.has_signal === true;
  const signalScore = hasLiveCrowdSignal && snapshot ? getCrowdLevelScore(snapshot.crowd_level) : 0;
  const ratingCount = ratingSummary?.review_count ?? 0;
  const vibe = venue.vibe?.trim() || (venue.kind === "club" ? "Club" : "Bar");
  const openingHours = mapVenueOpeningHours(venue.opening_hours);

  return {
    address: venue.address,
    averageRating: ratingCount > 0 ? toOptionalNumber(ratingSummary?.average_rating) : undefined,
    capacityEstimate: venue.capacity_estimate ?? 200,
    crowdLevel: snapshot?.crowd_level ?? "quiet",
    crowdTrend: getCrowdTrend(snapshot, previousSnapshot),
    dataSource: venue.source,
    hasLiveCrowdSignal,
    id: venue.id,
    isRemote: true,
    kind: venue.kind,
    lastUpdated: hasLiveCrowdSignal ? "Recent live signal" : "No current device signal",
    latitude: venue.latitude,
    longitude: venue.longitude,
    mockActivityScore: signalScore,
    name: venue.name,
    neighborhood: venue.neighborhood,
    nowPlaying: nowPlaying ? mapNowPlayingRow(nowPlaying) : undefined,
    openingHours,
    openingHoursSummary: getVenueOpenStateLabel(openingHours),
    ratingCount,
    slug: venue.slug,
    soundTags: getVenueSoundTags(venue.sound_tags, vibe),
    sourceCheckedAt: venue.source_checked_at ?? openingHours?.checkedAt,
    sourceExternalId: venue.source_external_id?.trim() || undefined,
    trendingHeadline: trending?.headline?.trim() || undefined,
    trendingRank: trending?.sort_rank,
    verificationStatus: venue.verification_status,
    vibe
  };
}

function mapVenueRatingRow(row: PublicVenueRatingRow): VenueRating {
  return {
    comment: row.comment?.trim() || undefined,
    id: row.id,
    isOwn: row.is_own,
    moderationStatus: row.moderation_status ?? undefined,
    rating: row.rating,
    updatedAt: row.updated_at,
    venueId: row.venue_id
  };
}

function mapSubmitJsonResult(data: unknown, fallbackMessage: string) {
  const result = data as SubmitJsonResult | null;

  return {
    ok: Boolean(result?.ok),
    message: result?.message ?? fallbackMessage
  };
}

function toOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function mapNowPlayingRow(nowPlaying: VenueNowPlayingRow): Venue["nowPlaying"] {
  return {
    artistName: nowPlaying.artist_name?.trim() || undefined,
    title: nowPlaying.track_title
  };
}

function mapMusicHistoryPeriod(rows: VenueMusicHistoryRow[]): VenueMusicHistory["daily"] {
  return {
    genres: rows
      .filter((row) => row.item_type === "genre" && row.genre)
      .sort((left, right) => left.item_rank - right.item_rank)
      .map((row) => ({ name: row.genre as string })),
    tracks: rows
      .filter((row) => row.item_type === "track" && row.track_title)
      .sort((left, right) => left.item_rank - right.item_rank)
      .map((row) => ({ artistName: row.artist_name?.trim() || undefined, title: row.track_title as string }))
  };
}

function getCrowdTrend(snapshot?: CrowdSnapshotRow, previousSnapshot?: CrowdSnapshotRow): CrowdTrend | undefined {
  if (!snapshot?.has_signal || !previousSnapshot?.has_signal) {
    return undefined;
  }

  const signalScore = getCrowdLevelScore(snapshot.crowd_level);
  const previousSignalScore = getCrowdLevelScore(previousSnapshot.crowd_level);

  const difference = signalScore - previousSignalScore;

  if (difference >= 0.08) {
    return "rising";
  }

  if (difference <= -0.08) {
    return "cooling";
  }

  return "steady";
}

function getLocalVenueResult(warning: string): VenueResult {
  return {
    source: "local",
    venues: localVenues,
    warning
  };
}

async function loadEnrichment<T>(load: () => Promise<T>, fallback: T) {
  try {
    return { data: await load(), failed: false };
  } catch {
    return { data: fallback, failed: true };
  }
}

function parsePublicVenueEnrichments(value: unknown): PublicVenueEnrichments | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const bundle = value as Record<string, unknown>;
  if (!Array.isArray(bundle.crowd_snapshots)
    || !Array.isArray(bundle.now_playing)
    || !Array.isArray(bundle.rating_summaries)
    || !Array.isArray(bundle.trending_venues)
    || !bundle.crowd_snapshots.every((row) => isPublicEnrichmentRow(row,
      ["created_at", "crowd_level", "has_signal", "id", "snapshot_rank", "venue_id"],
      (record) => typeof record.created_at === "string"
        && typeof record.crowd_level === "string"
        && typeof record.has_signal === "boolean"
        && typeof record.id === "string"
        && typeof record.snapshot_rank === "number"
        && typeof record.venue_id === "string"))
    || !bundle.now_playing.every((row) => isPublicEnrichmentRow(row,
      ["artist_name", "track_title", "venue_id"],
      (record) => (record.artist_name === null || typeof record.artist_name === "string")
        && typeof record.track_title === "string"
        && typeof record.venue_id === "string"))
    || !bundle.rating_summaries.every((row) => isPublicEnrichmentRow(row,
      ["average_rating", "review_count", "venue_id"],
      (record) => (record.average_rating === null || typeof record.average_rating === "number" || typeof record.average_rating === "string")
        && (record.review_count === null || typeof record.review_count === "number")
        && typeof record.venue_id === "string"))
    || !bundle.trending_venues.every((row) => isPublicEnrichmentRow(row,
      ["expires_at", "headline", "sort_rank", "venue_id"],
      (record) => typeof record.expires_at === "string"
        && (record.headline === null || typeof record.headline === "string")
        && typeof record.sort_rank === "number"
        && typeof record.venue_id === "string"))) {
    return null;
  }

  return bundle as PublicVenueEnrichments;
}

function isPublicEnrichmentRow(
  value: unknown,
  expectedKeys: string[],
  validate: (record: Record<string, unknown>) => boolean
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === expectedKeys.join(",") && validate(record);
}

function mapVenueOpeningHours(value: Record<string, unknown> | null): VenueOpeningHours | undefined {
  if (!value) {
    return undefined;
  }

  const checkedAt = value.checkedAt;
  const expression = value.expression;
  const source = value.source;
  const weekly = mapVenueWeeklyHours(value.weekly);

  if (typeof checkedAt !== "string" || (source !== "manual" && source !== "openstreetmap")) {
    return undefined;
  }

  return {
    checkedAt,
    ...(typeof expression === "string" && expression.trim() ? { expression: expression.trim() } : {}),
    source,
    ...(weekly ? { weekly } : {})
  };
}

function mapVenueWeeklyHours(value: unknown): VenueWeeklyOpeningHours | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const weekdays: VenueWeekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const weekly: VenueWeeklyOpeningHours = {};

  for (const weekday of weekdays) {
    const intervals = (value as Record<string, unknown>)[weekday];

    if (intervals === undefined) {
      continue;
    }

    if (!Array.isArray(intervals)) {
      return undefined;
    }

    const parsedIntervals = intervals.flatMap((interval) => {
      if (!interval || typeof interval !== "object") {
        return [];
      }

      const { endMinute, startMinute } = interval as Record<string, unknown>;
      return Number.isInteger(startMinute) && Number.isInteger(endMinute)
        && Number(startMinute) >= 0 && Number(endMinute) <= 1440 && Number(startMinute) < Number(endMinute)
        ? [{ endMinute: Number(endMinute), startMinute: Number(startMinute) }]
        : [];
    });

    if (parsedIntervals.length !== intervals.length) {
      return undefined;
    }

    weekly[weekday] = parsedIntervals;
  }

  return weekly;
}

function getVenueSoundTags(values: string[] | null, vibe: string) {
  const soundTags = (values ?? []).filter((value): value is VenueSoundTag => validVenueSoundTags.has(value as VenueSoundTag));

  if (soundTags.length === 0) {
    return deriveVenueSoundTags(vibe);
  }

  return [...new Set(soundTags)];
}
