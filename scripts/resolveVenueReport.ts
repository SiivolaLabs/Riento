import { createClient } from "@supabase/supabase-js";

type VenueReportRow = {
  created_at: string;
  details: string | null;
  id: string;
  reason: string;
  resolved_at: string | null;
  venue_id: string | null;
};

type VenueRow = {
  address: string;
  name: string;
  slug: string;
};

const reportId = process.argv[2];
const isConfirmed = process.argv.includes("--confirm-resolve");
const confirmedReportId = getArgValue("--confirm-report-id");
const allowResolved = process.argv.includes("--allow-resolved");
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!reportId) {
    throw new Error("Usage: npm run admin:resolve-venue-report -- <report-id> --confirm-resolve --confirm-report-id <report-id>");
  }

  if (isConfirmed && confirmedReportId !== reportId) {
    throw new Error(`Confirmed resolution requires --confirm-report-id ${reportId}.`);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this admin script.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data: report, error: reportError } = await adminClient
    .from("venue_reports")
    .select("id,venue_id,reason,details,resolved_at,created_at")
    .eq("id", reportId)
    .single();

  if (reportError || !report) {
    throw new Error(reportError?.message ?? "Venue report not found.");
  }

  const venueReport = report as VenueReportRow;
  const venue = venueReport.venue_id ? await getVenue(adminClient, venueReport.venue_id) : null;

  if (venueReport.resolved_at && !allowResolved) {
    console.log(`Venue report ${venueReport.id} is already resolved; no action taken.`);
    return;
  }

  console.log(`Report ${venueReport.id}: ${venueReport.reason}`);
  console.log(`Venue: ${venue ? `${venue.name} (${venue.slug}) / ${venue.address}` : "missing venue report"}`);
  console.log(`Details: ${venueReport.details ?? "No details provided."}`);

  if (!isConfirmed) {
    console.log(`Dry run only. Re-run with --confirm-resolve --confirm-report-id ${venueReport.id} after review and any venue data changes are complete.`);
    return;
  }

  const { data: resolvedReport, error: resolveError } = await adminClient
    .from("venue_reports")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", venueReport.id)
    .is("resolved_at", null)
    .select("id")
    .maybeSingle();

  if (resolveError) {
    throw new Error(resolveError.message);
  }

  if (!resolvedReport) {
    throw new Error("Venue report was already resolved or changed while processing.");
  }

  console.log(`Resolved venue report ${venueReport.id}.`);
}

async function getVenue(adminClient: any, venueId: string) {
  const { data, error } = await adminClient
    .from("venues")
    .select("slug,name,address")
    .eq("id", venueId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? data as VenueRow : null;
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag);
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;

  return value && !value.startsWith("--") ? value : undefined;
}
