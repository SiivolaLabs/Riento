import { createClient } from "@supabase/supabase-js";

type NowPlayingSource = "manual" | "user_audio_match" | "user_confirmation" | "venue_spotify";

type VenueMusicReportRow = {
  artist_name: string | null;
  created_at: string;
  id: string;
  report_source: Extract<NowPlayingSource, "user_audio_match" | "user_confirmation">;
  resolved_at: string | null;
  track_title: string;
  venue_id: string;
};

type VenueRow = {
  id: string;
  name: string;
  slug: string;
};

type AdminClient = any;

const allowedSources: NowPlayingSource[] = ["manual", "user_audio_match", "user_confirmation", "venue_spotify"];
const reportId = getArgValue("--report-id");
const venueId = getArgValue("--venue-id");
const venueSlug = getArgValue("--venue-slug");
const titleArg = getArgValue("--title");
const artistArg = getArgValue("--artist");
const genreArg = getArgValue("--genre");
const albumArg = getArgValue("--album");
const spotifyTrackIdArg = getArgValue("--spotify-track-id");
const sourceArg = getArgValue("--source") ?? "manual";
const isConfirmed = process.argv.includes("--confirm-set");
const confirmedReportId = getArgValue("--confirm-report-id");
const confirmedVenueId = getArgValue("--confirm-venue-id");
const confirmedVenueSlug = getArgValue("--confirm-venue-slug");
const allowResolved = process.argv.includes("--allow-resolved");
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!reportId && !venueId && !venueSlug) {
    throw new Error("Usage: npm run admin:set-now-playing -- --report-id <report-id> --confirm-set --confirm-report-id <report-id> OR --venue-slug <slug> --title <track> [--artist <artist>] --confirm-set --confirm-venue-slug <slug>");
  }

  if (reportId && venueId) {
    throw new Error("Use either --report-id or a direct venue target, not both.");
  }

  if (reportId && venueSlug) {
    throw new Error("Use either --report-id or a direct venue target, not both.");
  }

  if (venueId && venueSlug) {
    throw new Error("Use either --venue-id or --venue-slug for a direct trusted update, not both.");
  }

  if (isConfirmed) {
    assertConfirmedTarget();
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this admin script.");
  }

  if (!allowedSources.includes(sourceArg as NowPlayingSource)) {
    throw new Error(`Invalid source. Use one of: ${allowedSources.join(", ")}.`);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const report = reportId ? await getReport(adminClient, reportId) : null;

  if (report?.resolved_at && !allowResolved) {
    console.log(`Now-playing report ${report.id} is already resolved; no action taken.`);
    return;
  }

  const venue = report ? await getVenueById(adminClient, report.venue_id) : await getVenueFromArgs(adminClient);
  const source = report ? report.report_source : (sourceArg as NowPlayingSource);
  const trackTitle = (report?.track_title ?? titleArg ?? "").trim();
  const artistName = (report?.artist_name ?? artistArg ?? "").trim();
  const genre = genreArg?.trim() || null;
  const ttlMinutes = getNumberArg("--ttl-minutes", 45, 5, 240);
  const confidence = getNumberArg("--confidence", getDefaultConfidence(source), 0, 1);
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + ttlMinutes * 60 * 1000);

  if (!trackTitle) {
    throw new Error("Track title is required. Use --title for direct trusted updates, or pass a report with a track title.");
  }

  if (!report && isUserReportSource(source)) {
    throw new Error(`${source} can only be promoted from a private venue_music_reports row. Use --report-id, or use --source manual/venue_spotify for direct trusted updates.`);
  }

  if (!isConfirmed) {
    console.log(`Dry run only. ${venue.name} will show "${formatTrack(trackTitle, artistName)}" from ${source} for ${ttlMinutes} minutes.`);
    console.log(`Re-run with --confirm-set ${getConfirmationHint(venue)} to update public venue_now_playing.`);
    return;
  }

  if (report && !allowResolved) {
    await assertReportStillUnresolved(adminClient, report.id);
  }

  const { error: upsertError } = await adminClient.from("venue_now_playing").upsert({
    album_name: albumArg?.trim() || null,
    artist_name: artistName || null,
    confidence,
    expires_at: expiresAt.toISOString(),
    observed_at: observedAt.toISOString(),
    origin_report_id: report?.id ?? null,
    source,
    spotify_track_id: spotifyTrackIdArg?.trim() || null,
    track_title: trackTitle,
    venue_id: venue.id
  }, { onConflict: "venue_id" });

  if (upsertError) {
    throw new Error(upsertError.message);
  }

  const { error: observationError } = await adminClient.from("venue_music_observations").insert({
    artist_name: artistName || null,
    confidence,
    genre,
    observed_at: observedAt.toISOString(),
    origin_report_id: report?.id ?? null,
    source,
    spotify_track_id: spotifyTrackIdArg?.trim() || null,
    track_title: trackTitle,
    venue_id: venue.id
  });

  if (observationError) {
    throw new Error(observationError.message);
  }

  if (report) {
    let reportUpdate = adminClient
      .from("venue_music_reports")
      .update({ resolved_at: observedAt.toISOString() })
      .eq("id", report.id);

    if (!allowResolved) {
      reportUpdate = reportUpdate.is("resolved_at", null);
    }

    const { data: resolvedReport, error: reportUpdateError } = await reportUpdate
      .select("id")
      .maybeSingle();

    if (reportUpdateError) {
      throw new Error(reportUpdateError.message);
    }

    if (!resolvedReport) {
      throw new Error("Now-playing report was already resolved or changed while processing; public now-playing rows may need manual review.");
    }
  }

  console.log(`Updated now-playing for ${venue.name}: ${formatTrack(trackTitle, artistName)}.`);
  console.log("Added a public venue music observation for history/profile views.");
  console.log(`Expires at ${expiresAt.toISOString()}.`);
}

async function assertReportStillUnresolved(adminClient: AdminClient, id: string) {
  const { data, error } = await adminClient
    .from("venue_music_reports")
    .select("id")
    .eq("id", id)
    .is("resolved_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Now-playing report was already resolved or changed before promotion started.");
  }
}

async function getReport(adminClient: AdminClient, id: string) {
  const { data, error } = await adminClient
    .from("venue_music_reports")
    .select("id,venue_id,track_title,artist_name,report_source,resolved_at,created_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Now-playing report not found.");
  }

  return data as VenueMusicReportRow;
}

async function getVenueFromArgs(adminClient: AdminClient) {
  if (venueId) {
    return getVenueById(adminClient, venueId);
  }

  if (!venueSlug) {
    throw new Error("Use --venue-id or --venue-slug for direct trusted now-playing updates.");
  }

  const { data, error } = await adminClient
    .from("venues")
    .select("id,slug,name")
    .eq("slug", venueSlug)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Venue not found.");
  }

  return data as VenueRow;
}

async function getVenueById(adminClient: AdminClient, id: string) {
  const { data, error } = await adminClient
    .from("venues")
    .select("id,slug,name")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Venue not found.");
  }

  return data as VenueRow;
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag);
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;

  return value && !value.startsWith("--") ? value : undefined;
}

function getNumberArg(flag: string, fallback: number, min: number, max: number) {
  const rawValue = getArgValue(flag);
  const value = rawValue ? Number(rawValue) : fallback;

  if (!Number.isFinite(value)) {
    throw new Error(`${flag} must be a number.`);
  }

  if (rawValue && (value < min || value > max)) {
    throw new Error(`${flag} must be between ${min} and ${max}.`);
  }

  return value;
}

function isUserReportSource(source: NowPlayingSource) {
  return source === "user_audio_match" || source === "user_confirmation";
}

function getDefaultConfidence(source: NowPlayingSource) {
  switch (source) {
    case "venue_spotify":
      return 0.95;
    case "user_audio_match":
      return 0.82;
    case "user_confirmation":
      return 0.72;
    case "manual":
      return 0.6;
  }
}

function formatTrack(title: string, artistName: string) {
  return artistName ? `${title} - ${artistName}` : title;
}

function assertConfirmedTarget() {
  if (reportId) {
    if (confirmedReportId !== reportId) {
      throw new Error(`Confirmed report promotion requires --confirm-report-id ${reportId}.`);
    }

    return;
  }

  if (venueId) {
    if (confirmedVenueId !== venueId) {
      throw new Error(`Confirmed direct update requires --confirm-venue-id ${venueId}.`);
    }

    return;
  }

  if (venueSlug) {
    if (confirmedVenueSlug !== venueSlug) {
      throw new Error(`Confirmed direct update requires --confirm-venue-slug ${venueSlug}.`);
    }

    return;
  }

  throw new Error("A now-playing target is required.");
}

function getConfirmationHint(venue: VenueRow) {
  if (reportId) {
    return `--confirm-report-id ${reportId}`;
  }

  if (venueId) {
    return `--confirm-venue-id ${venue.id}`;
  }

  return `--confirm-venue-slug ${venue.slug}`;
}
