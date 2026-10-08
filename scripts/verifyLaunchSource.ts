import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const [schema, finalHardening, schedule, edgeFunction, venueService, loadTest, musicRecognitionService, musicSettingsService, profileService, mapScreen, topScreen, venueScreen, authContext, appJson, privacyPolicy, setupSql] = await Promise.all([
    read("supabase/schema.sql"),
    read("supabase/launch_hardening_final.sql"),
    read("supabase/schedule_crowd_snapshots.sql"),
    read("supabase/functions/recognize-android-music/index.ts"),
    read("src/services/venueService.ts"),
    read("scripts/loadTestLaunchReads.ts"),
    read("src/services/musicRecognitionService.ts"),
    read("src/services/musicRecognitionSettingsService.ts"),
    read("src/services/profileService.ts"),
    read("app/(tabs)/index.tsx"),
    read("app/(tabs)/leaderboard.tsx"),
    read("app/venue/[id].tsx"),
    read("src/context/AuthContext.tsx"),
    read("app.json"),
    read("docs/PRIVACY_POLICY.html"),
    read("supabase/setup_all.sql")
  ]);

  requireText(schema, "2026-08-02-public-enrichment-cache-1", "schema readiness version");
  requireText(schema, "create table if not exists public.launch_runtime_controls", "runtime kill switches");
  requireText(schema, "create table if not exists public.launch_rate_buckets", "global launch budgets");
  requireText(schema, "community_sample_size >= 2", "k=2 community publication");
  requireText(schema, "crowd_snapshots_venue_bucket_uidx", "bounded snapshot buckets");
  requireText(schema, "Client-provided audio matches cannot be published.", "client audio-match rejection");
  requireText(schema, "create or replace function public.publish_provider_music_match", "trusted provider publication");
  requireText(schema, "create or replace function public.launch_submit_music_match_feedback", "private detected-music feedback");
  requireText(schema, "check (feedback_is_correct is null or user_id is not null)", "owned private music feedback");
  requireText(schema, "create or replace function public.launch_set_admin_venue_now_playing", "trusted admin music publication");
  requireText(schema, "p_venue_id, v_title, v_artist, 'manual', 1", "fixed trusted admin music source");
  requireText(schema, "v_now + interval '45 minutes'", "fixed trusted admin music expiry");
  requireText(schema, "having count(*) >= 3", "public rating minimum");
  requireText(schema, "'track'::text as item_type", "named music-history union output");
  requireText(schema, "create table if not exists public.public_venue_enrichment_cache", "public enrichment singleton cache");
  requireText(schema, "create or replace function public.get_public_venue_enrichments()", "public enrichment bundle RPC");
  requireText(finalHardening, "select public.launch_submit_venue_signal", "final crowd wrapper");
  requireText(finalHardening, "select public.launch_submit_venue_music_report", "final music wrapper");
  requireText(finalHardening, "get_public_venue_music_history", "coarse music history RPC");
  requireText(finalHardening, "set_admin_venue_now_playing", "final trusted admin music wrapper");
  requireText(finalHardening, "submit_music_match_feedback", "final private feedback wrapper");
  requireText(finalHardening, "'track'::text as item_type", "final named music-history union output");
  requireText(finalHardening, "revoke all on table public.venue_now_playing", "private music tables");
  requireText(finalHardening, "get_launch_music_security_status", "music-table privilege readiness probe");
  requireText(finalHardening, "create table if not exists public.public_venue_enrichment_cache", "final public enrichment singleton cache");
  requireText(finalHardening, "create or replace function public.get_public_venue_enrichments()", "final public enrichment bundle RPC");
  requireText(schedule, "riento-cleanup-launch-rate-buckets", "launch-budget cleanup cron");
  requireText(schedule, "get_launch_maintenance_status", "maintenance-job readiness probe");
  requireText(edgeFunction, "@supabase/supabase-js@2.110.0", "pinned Edge dependency");
  requireText(edgeFunction, "publish_provider_music_match", "Edge-owned provider publication");
  requireText(edgeFunction, "AbortSignal.timeout", "provider timeout");
  requireText(venueService, "venueListMaxStaleMs", "bounded stale venue cache");
  requireText(venueService, "venueListPollMs", "shared jittered venue polling");
  requireText(venueService, "provisionalVenueListSnapshot", "immediate provisional cold-start venues");
  requireText(venueService, 'AppState.addEventListener("change", handleVenueListAppStateChange)', "foreground-aware venue polling");
  requireText(venueService, "venueRowsFreshMs", "stable base-venue row cache");
  requireText(venueService, "preserveFailedVenueEnrichments", "last-good partial enrichment fallback");
  requireText(venueService, '.from("public_venue_enrichment_cache")', "cached public enrichment client read");
  requireText(venueService, "parsePublicVenueEnrichments", "strict public enrichment bundle parsing");
  rejectText(venueService, 'rpc("get_public_venue_enrichments")', "queued enrichment RPC client read");
  requireText(venueService, 'rpc("get_public_venue_music_history"', "coarse history client read");
  rejectText(venueService, 'rpc("get_latest_crowd_snapshots")', "separate crowd list read");
  rejectText(venueService, 'rpc("get_public_venue_now_playing")', "separate now-playing list read");
  rejectText(venueService, 'rpc("get_venue_review_summaries")', "separate rating-summary list read");
  rejectText(venueService, 'rpc("get_curated_trending_venues")', "separate Trending list read");
  rejectText(venueService, '.from("venue_now_playing")', "direct now-playing table read");
  rejectText(venueService, '.from("venue_music_observations")', "direct music-history table read");
  requireText(loadTest, 'const endpointNames = ["venues", "enrichments"]', "two-request load-test endpoint set");
  requireText(loadTest, 'public_venue_enrichment_cache?select=payload&limit=1', "cached enrichment table load test");
  requireText(loadTest, "concurrency * 2", "two-request cold-open load count");
  rejectText(loadTest, "rpc/get_latest_crowd_snapshots", "legacy crowd load-test request");
  rejectText(loadTest, "rpc/get_public_venue_enrichments", "queued bundled-RPC load-test request");
  requireText(musicRecognitionService, "createLaunchMusicCheckIntent", "process-bound launch music intent");
  requireText(musicRecognitionService, "consumeLaunchMusicCheckIntent", "single-use launch music intent");
  requireText(musicSettingsService, "Saved music recognition settings could not be read.", "fail-closed music settings");
  requireText(musicSettingsService, "listener(unavailableMusicRecognitionSettings)", "cross-screen music setting save failure");
  requireText(profileService, "gpsOnMapOpen: false,\n  manualPlacementEnabled: false", "fail-closed unavailable profile settings");
  requireText(profileService, "listener(unavailableProfileSettings)", "cross-screen profile setting save failure");
  rejectText(mapScreen, "setInterval(", "Map screen-local polling");
  requireText(mapScreen, "Check venue & song", "explicit cold-open venue and music check");
  requireText(mapScreen, "createLaunchMusicCheckIntent", "launch intent creation after explicit venue check");
  requireText(mapScreen, "Math.ceil(limit * 0.7)", "activity-biased capped map markers");
  requireText(mapScreen, 'mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}', "muted iOS Apple map");
  requireText(mapScreen, "setCommittedMapRegion(pendingMapRegion.current)", "immediate explicit area commit");
  requireText(mapScreen, "onPress={handleMapPress}", "map-background selected-card dismissal");
  requireText(mapScreen, "stopPropagation", "marker press isolation from map dismissal");
  rejectText(mapScreen, "Refresh this area", "manual marker refresh gate");
  rejectText(topScreen, "setInterval(", "Top screen-local polling");
  requireText(topScreen, "<FlatList", "virtualized Top venue cards");
  requireText(topScreen, "keyExtractor={({ venue }) => venue.slug}", "slug-stable Top venue rows");
  rejectText(venueScreen, "setInterval(", "venue-detail screen-local polling");
  rejectText(venueScreen, '"user_audio_match"', "client audio-match publication");
  requireText(venueScreen, "submitMusicMatchFeedback", "detected venue/song feedback UI");
  requireText(venueScreen, "setAdminVenueNowPlaying", "admin trusted music UI");
  requireText(venueScreen, "consumeLaunchMusicCheckIntent", "launch intent consumption before recognition");
  requireText(authContext, "const userId = currentUser.id;\n    setAdminUserId(null);", "fail-closed admin status refresh");
  requireText(appJson, '"version": "0.1.2"', "launch-hardened app version");
  requireText(privacyPolicy, "One device contribution remains private.", "k=2 legal disclosure");
  requireText(privacyPolicy, "keep the match on that device", "local-only iOS disclosure");
  requireText(privacyPolicy, "without an inbox-ownership confirmation message", "pilot email auto-confirm disclosure");
  requireText(setupSql, "2026-08-02-public-enrichment-cache-1", "generated launch schema");

  if (setupSql.lastIndexOf("-- >>> launch_hardening_final.sql") < setupSql.lastIndexOf("-- <<< schema.sql")) {
    throw new Error("Final launch hardening is not ordered after the cumulative schema.");
  }

  const finalSchemaMusicWrapper = schema.slice(schema.lastIndexOf("create or replace function public.submit_venue_music_report"));
  requireText(finalSchemaMusicWrapper, "select public.launch_submit_venue_music_report", "safe final cumulative music wrapper");

  verifyPublicEnrichmentFunction(schema, "cumulative schema");
  verifyPublicEnrichmentFunction(finalHardening, "final hardening");

  const providerFunction = schema.slice(
    schema.indexOf("create or replace function public.publish_provider_music_match"),
    schema.indexOf("revoke execute on function public.publish_provider_music_match")
  );

  if (providerFunction.indexOf("set consumed_at = v_now") < providerFunction.indexOf("A current venue signal is required")) {
    throw new Error("Provider recognition attempts are consumed before current venue placement is validated.");
  }

  console.log("Launch-hardening source invariants pass.");
}

function verifyPublicEnrichmentFunction(contents: string, label: string) {
  const builderStart = contents.lastIndexOf("create or replace function public.build_public_venue_enrichment_payload()");
  const builderEnd = contents.indexOf("revoke execute on function public.build_public_venue_enrichment_payload()", builderStart);
  const builderSql = contents.slice(builderStart, builderEnd);
  const readerStart = contents.lastIndexOf("create or replace function public.get_public_venue_enrichments()");
  const readerEnd = contents.indexOf("revoke execute on function public.get_public_venue_enrichments()", readerStart);
  const readerSql = contents.slice(readerStart, readerEnd);

  requireText(contents, "alter table public.public_venue_enrichment_cache enable row level security;", `${label} enrichment cache RLS`);
  requireText(contents, "grant select (payload, refreshed_at) on table public.public_venue_enrichment_cache to anon, authenticated;", `${label} reviewed cache column grants`);
  requireText(contents, "perform public.refresh_public_venue_enrichment_cache();", `${label} scheduled cache refresh`);
  requireText(builderSql, "security definer", `${label} enrichment builder security mode`);
  requireText(builderSql, "set search_path = pg_catalog", `${label} enrichment builder search path`);
  requireText(builderSql, "from public.get_latest_crowd_snapshots()", `${label} coarse crowd dependency`);
  requireText(builderSql, "from public.get_public_venue_now_playing()", `${label} coarse now-playing dependency`);
  requireText(builderSql, "from public.get_venue_review_summaries()", `${label} coarse rating dependency`);
  requireText(builderSql, "from public.get_curated_trending_venues()", `${label} coarse Trending dependency`);
  requireText(readerSql, "security invoker", `${label} enrichment reader security mode`);
  requireText(readerSql, "set search_path = pg_catalog", `${label} enrichment reader search path`);
  requireText(readerSql, "select cache.payload from public.public_venue_enrichment_cache", `${label} cached enrichment read`);
  requireText(contents, "revoke execute on function public.get_public_venue_enrichments() from public;", `${label} bundle default-execute revocation`);
  requireText(contents, "grant execute on function public.get_public_venue_enrichments() to anon, authenticated;", `${label} bundle app-role grant`);
  rejectText(builderSql, "sample_size", `${label} protected crowd count`);
  rejectText(builderSql, "signal_score", `${label} protected crowd score`);
  rejectText(builderSql, "user_id", `${label} user identity`);
  rejectText(builderSql, "created_by", `${label} admin identity`);
  rejectText(builderSql, "source_attempt_id", `${label} music provider metadata`);
  rejectText(readerSql, "get_latest_crowd_snapshots", `${label} per-request crowd recomputation`);
}

async function read(path: string) {
  return readFile(resolve(rootDir, path), "utf8");
}

function requireText(contents: string, expected: string, label: string) {
  if (!contents.includes(expected)) {
    throw new Error(`Missing ${label}: ${expected}`);
  }
}

function rejectText(contents: string, rejected: string, label: string) {
  if (contents.includes(rejected)) {
    throw new Error(`Unsafe ${label} is present: ${rejected}`);
  }
}
