import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { venues } from "../src/data/venues";

const expectedSchemaVersion = "2026-08-02-public-enrichment-cache-1";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const legalBaseUrl = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? "https://riento.expo.app/legal").replace(/\/$/, "");
const legalPageNames = [
  "index.html",
  "ACCOUNT_DELETION.html",
  "COMMUNITY_GUIDELINES.html",
  "PRIVACY_POLICY.html",
  "SUPPORT.html",
  "TERMS.html"
];

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!supabaseUrl || !anonKey) {
    throw new Error("Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY before running the live launch verification.");
  }

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json"
  };
  const readinessResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_launch_readiness_status`, {
    method: "POST",
    headers,
    body: "{}"
  });
  const readinessRows = await readJson(readinessResponse);
  const readiness = Array.isArray(readinessRows) ? readinessRows[0] : readinessRows;

  if (!readinessResponse.ok || readiness?.schema_version !== expectedSchemaVersion) {
    throw new Error(`Production schema does not report ${expectedSchemaVersion}. Apply the canonical schema before rollout.`);
  }

  const disabledFeatures = [
    "crowd_writes_enabled",
    "ratings_enabled",
    "written_reviews_enabled",
    "venue_reports_enabled",
    "music_sharing_enabled",
    "audio_recognition_enabled"
  ].filter((key) => readiness[key] !== true);

  if (disabledFeatures.length > 0) {
    throw new Error(`Launch controls are disabled: ${disabledFeatures.join(", ")}. Keep rollout paused or explicitly restore them.`);
  }

  const snapshotAgeMs = Date.now() - new Date(readiness.latest_snapshot_at).getTime();

  if (!Number.isFinite(snapshotAgeMs) || snapshotAgeMs < 0 || snapshotAgeMs > 20 * 60_000) {
    throw new Error("The latest bucketed crowd snapshot is missing or older than 20 minutes. Check the crowd cron job.");
  }

  const [maintenanceResponse, musicSecurityResponse, enrichmentCacheResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/rpc/get_launch_maintenance_status`, { method: "POST", headers, body: "{}" }),
    fetch(`${supabaseUrl}/rest/v1/rpc/get_launch_music_security_status`, { method: "POST", headers, body: "{}" }),
    fetch(`${supabaseUrl}/rest/v1/rpc/get_public_venue_enrichment_cache_status`, { method: "POST", headers, body: "{}" })
  ]);
  const maintenanceRows = await readJson(maintenanceResponse);
  const maintenance = Array.isArray(maintenanceRows) ? maintenanceRows[0] : maintenanceRows;
  const musicSecurityRows = await readJson(musicSecurityResponse);
  const musicSecurity = Array.isArray(musicSecurityRows) ? musicSecurityRows[0] : musicSecurityRows;
  const enrichmentCacheRows = await readJson(enrichmentCacheResponse);
  const enrichmentCache = Array.isArray(enrichmentCacheRows) ? enrichmentCacheRows[0] : enrichmentCacheRows;

  if (!maintenanceResponse.ok
    || maintenance?.expected_job_count !== 4
    || maintenance?.active_job_count !== 4
    || maintenance?.configured_job_count !== 4
    || maintenance?.failing_job_count !== 0) {
    throw new Error("Production maintenance jobs are missing, misconfigured, inactive, or currently failing.");
  }

  if (!musicSecurityResponse.ok || musicSecurity?.music_tables_private !== true) {
    throw new Error("Production music tables retain direct app-role privileges.");
  }

  if (!enrichmentCacheResponse.ok
    || typeof enrichmentCache?.refreshed_at !== "string"
    || typeof enrichmentCache?.cache_age_seconds !== "number"
    || enrichmentCache.cache_age_seconds < 0
    || enrichmentCache.cache_age_seconds > 5 * 60) {
    throw new Error("The public venue enrichment cache is missing or older than five minutes.");
  }

  const venuesResponse = await fetch(
    `${supabaseUrl}/rest/v1/venues?select=id&verification_status=in.(needs_verification,verified)`,
    { headers: { ...headers, Prefer: "count=exact" } }
  );
  const venueRows = await readJson(venuesResponse);

  if (!venuesResponse.ok || !Array.isArray(venueRows) || venueRows.length !== venues.length) {
    throw new Error(`Production has ${Array.isArray(venueRows) ? venueRows.length : "unknown"} active venues; release source expects ${venues.length}.`);
  }

  const protectedColumnResponse = await fetch(
    `${supabaseUrl}/rest/v1/crowd_snapshots?select=sample_size,signal_score&limit=1`,
    { headers }
  );

  if (protectedColumnResponse.ok) {
    throw new Error("Protected crowd counts or scores are readable by the public app role.");
  }

  const [enrichmentRpc, enrichmentCacheRead, protectedCacheColumn, nowPlayingRpc, historyRpc, directNowPlaying, directHistory, directAdminActions, adminMusicRpc, feedbackRpc] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/rpc/get_public_venue_enrichments`, { method: "POST", headers, body: "{}" }),
    fetch(`${supabaseUrl}/rest/v1/public_venue_enrichment_cache?select=payload&limit=1`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/public_venue_enrichment_cache?select=singleton&limit=1`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/rpc/get_public_venue_now_playing`, { method: "POST", headers, body: "{}" }),
    fetch(`${supabaseUrl}/rest/v1/rpc/get_public_venue_music_history`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_venue_id: venueRows[0]?.id })
    }),
    fetch(`${supabaseUrl}/rest/v1/venue_now_playing?select=venue_id&limit=1`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/venue_music_observations?select=id&limit=1`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/admin_music_actions?select=id&limit=1`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/rpc/set_admin_venue_now_playing`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_venue_id: venueRows[0]?.id, p_track_title: "Readiness probe", p_artist_name: null })
    }),
    fetch(`${supabaseUrl}/rest/v1/rpc/submit_music_match_feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_venue_id: venueRows[0]?.id, p_track_title: "Readiness probe", p_artist_name: null, p_is_correct: true })
    })
  ]);
  const enrichmentBundle = await readJson(enrichmentRpc);
  const directCacheRows = await readJson(enrichmentCacheRead);
  const cachedEnrichmentBundle = Array.isArray(directCacheRows) ? directCacheRows[0]?.payload : null;

  if (!enrichmentRpc.ok || !isValidPublicEnrichmentBundle(enrichmentBundle)) {
    throw new Error("The public venue enrichment RPC is missing, malformed, or exposes fields outside its reviewed contract.");
  }

  if (!enrichmentCacheRead.ok || !isValidPublicEnrichmentBundle(cachedEnrichmentBundle) || protectedCacheColumn.ok) {
    throw new Error("The public venue enrichment cache read or its protected-column boundary is invalid.");
  }

  if (!nowPlayingRpc.ok || !historyRpc.ok || directNowPlaying.ok || directHistory.ok || directAdminActions.ok) {
    throw new Error("Coarse music RPCs or private underlying table permissions do not match the launch schema.");
  }

  const expectedMutationDenials = new Set([400, 401, 403]);

  if (!expectedMutationDenials.has(adminMusicRpc.status) || !expectedMutationDenials.has(feedbackRpc.status)) {
    throw new Error("Trusted admin music or private feedback RPCs are missing or do not reject unauthenticated callers.");
  }

  const authSettingsResponse = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } });
  const authSettings = await readJson(authSettingsResponse);

  if (!authSettingsResponse.ok || authSettings?.mailer_autoconfirm !== true) {
    throw new Error("The pilot expects immediate email-account activation. Enable mailer autoconfirm or update the reviewed launch policy.");
  }

  await verifyLegalPages();
  await expectStatus(`${supabaseUrl}/functions/v1/recognize-android-music`, 401, { method: "POST" });
  await expectStatus(`${supabaseUrl}/functions/v1/delete-device-data`, 400, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });

  console.log(`Launch readiness passed: schema ${expectedSchemaVersion}, ${venues.length} venues, crowd snapshot age ${Math.round(snapshotAgeMs / 1000)}s.`);
}

async function verifyLegalPages() {
  for (const name of legalPageNames) {
    const expected = await readFile(resolve(rootDir, "public/legal", name), "utf8");
    const response = await fetch(`${legalBaseUrl}/${name}`, { cache: "no-store" });

    if (!response.ok || await response.text() !== expected) {
      throw new Error(`Live legal page ${name} does not match the release source.`);
    }
  }
}

async function expectStatus(url: string, expectedStatus: number, init: RequestInit) {
  const response = await fetch(url, init);

  if (response.status !== expectedStatus) {
    throw new Error(`${url} returned HTTP ${response.status}; expected ${expectedStatus}.`);
  }
}

async function readJson(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received HTTP ${response.status}.`);
  }
}

function isValidPublicEnrichmentBundle(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const bundle = value as Record<string, unknown>;
  const allowedKeys = {
    crowd_snapshots: new Set(["id", "venue_id", "crowd_level", "has_signal", "created_at", "snapshot_rank"]),
    now_playing: new Set(["venue_id", "track_title", "artist_name"]),
    rating_summaries: new Set(["venue_id", "average_rating", "review_count"]),
    trending_venues: new Set(["venue_id", "sort_rank", "headline", "expires_at"])
  };

  if (Object.keys(bundle).sort().join(",") !== Object.keys(allowedKeys).sort().join(",")) {
    return false;
  }

  return Object.entries(allowedKeys).every(([key, allowedRowKeys]) => {
    const rows = bundle[key];
    return Array.isArray(rows) && rows.every((row) => row
      && typeof row === "object"
      && !Array.isArray(row)
      && Object.keys(row).length === allowedRowKeys.size
      && Object.keys(row).every((rowKey) => allowedRowKeys.has(rowKey)));
  });
}
