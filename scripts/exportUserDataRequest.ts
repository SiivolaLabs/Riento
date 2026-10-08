import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

type DataExportRequestRow = {
  id: string;
  requested_email: string | null;
  status: "cancelled" | "completed" | "processing" | "requested";
  user_id: string | null;
};

const requestId = process.argv[2];
const isConfirmed = process.argv.includes("--confirm-export");
const confirmedRequestId = getArgValue("--confirm-request-id");
const outputPath = getOutputPath();
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!requestId) {
    throw new Error("Usage: npm run admin:export-user-data -- <request-id> --confirm-export --confirm-request-id <request-id> [--output /secure/path/export.json]");
  }

  if (isConfirmed) {
    if (confirmedRequestId !== requestId) {
      throw new Error(`Confirmed export requires --confirm-request-id ${requestId}.`);
    }

    if (outputPath) {
      assertSafeOutputPath(outputPath);
    }
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

  const { data: request, error: requestError } = await adminClient
    .from("data_export_requests")
    .select("id,user_id,requested_email,status")
    .eq("id", requestId)
    .single();

  if (requestError || !request) {
    throw new Error(requestError?.message ?? "Data export request not found.");
  }

  const exportRequest = request as DataExportRequestRow;

  if (exportRequest.status === "completed") {
    console.log("Data export request is already completed.");
    return;
  }

  if (exportRequest.status === "cancelled") {
    console.log("Data export request is cancelled; no action taken.");
    return;
  }

  if (!isConfirmed) {
    console.log(`Dry run only. Request ${exportRequest.id} is ${exportRequest.status} for ${exportRequest.requested_email ?? exportRequest.user_id ?? "unknown user"}.`);
    console.log(`Re-run with --confirm-export --confirm-request-id ${exportRequest.id} --output /secure/path/export.json to write the export file and mark the request completed.`);
    return;
  }

  if (!outputPath) {
    throw new Error("Confirmed exports require --output /secure/path/export.json. Do not write sensitive export files to a default temp path.");
  }

  if (!exportRequest.user_id) {
    throw new Error("Request has no user_id. Handle this manually from audit/support records.");
  }

  const { data: processingRequest, error: processingError } = await adminClient
    .from("data_export_requests")
    .update({ status: "processing" })
    .eq("id", exportRequest.id)
    .in("status", ["requested", "processing"])
    .select("id")
    .maybeSingle();

  if (processingError) {
    throw new Error(processingError.message);
  }

  if (!processingRequest) {
    throw new Error("Data export request is no longer active; it may have been cancelled or completed.");
  }

  const authUser = await adminClient.auth.admin.getUserById(exportRequest.user_id);

  if (authUser.error) {
    throw new Error(authUser.error.message);
  }

  const [profile, venuePings, manualCheckins, venueReports, venueReviews, venueMusicReports, savedVenues, appAdminRows, adminVenueSignals, curatedTrendingVenues, dataExportRequests, accountDeletionRequests] = await Promise.all([
    selectRows(adminClient, "profiles", "*", exportRequest.user_id, "id"),
    selectRows(adminClient, "venue_pings", "*", exportRequest.user_id),
    selectRows(adminClient, "manual_checkins", "*", exportRequest.user_id),
    selectRows(adminClient, "venue_reports", "*", exportRequest.user_id),
    selectRows(adminClient, "venue_reviews", "*", exportRequest.user_id),
    selectRows(adminClient, "venue_music_reports", "*", exportRequest.user_id),
    selectRows(adminClient, "user_saved_venues", "*", exportRequest.user_id),
    selectRows(adminClient, "app_admins", "*", exportRequest.user_id, "user_id"),
    selectRows(adminClient, "admin_venue_signals", "*", exportRequest.user_id, "admin_user_id"),
    selectRows(adminClient, "curated_trending_venues", "*", exportRequest.user_id, "created_by"),
    selectRows(adminClient, "data_export_requests", "*", exportRequest.user_id),
    selectRows(adminClient, "account_deletion_requests", "*", exportRequest.user_id)
  ]);

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    requestId: exportRequest.id,
    userId: exportRequest.user_id,
    authUser: authUser.data.user,
    profile,
    venuePings,
    manualCheckins,
    venueReports,
    venueReviews,
    venueMusicReports,
    savedVenues,
    appAdminRows,
    adminVenueSignals,
    curatedTrendingVenues,
    dataExportRequests,
    accountDeletionRequests
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(exportPayload, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });

  const { data: completedRequest, error: completedError } = await adminClient
    .from("data_export_requests")
    .update({ completed_at: new Date().toISOString(), status: "completed" })
    .eq("id", exportRequest.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (completedError) {
    throw new Error(completedError.message);
  }

  if (!completedRequest) {
    throw new Error("Data export request was changed while processing; export file was written but the request was not marked completed.");
  }

  console.log(`Wrote data export to ${outputPath} with owner-only file permissions.`);
  console.log(`Completed data export request ${exportRequest.id}.`);
}

async function selectRows(adminClient: any, tableName: string, columns: string, userId: string, idColumn = "user_id") {
  const { data, error } = await adminClient.from(tableName).select(columns).eq(idColumn, userId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function getOutputPath() {
  const outputFlagIndex = process.argv.indexOf("--output");
  const providedPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : undefined;

  if (providedPath && !providedPath.startsWith("--")) {
    return resolve(providedPath);
  }

  return null;
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag);
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;

  return value && !value.startsWith("--") ? value : undefined;
}

function assertSafeOutputPath(outputPath: string) {
  const unsafeLocation = getUnsafeLocation(outputPath);

  if (unsafeLocation) {
    throw new Error(`Refusing to write sensitive export JSON to ${unsafeLocation}: ${outputPath}`);
  }
}

function getUnsafeLocation(outputPath: string) {
  if (isPathInside(outputPath, tmpdir())) {
    return "a temp directory";
  }

  if (isPathInside(outputPath, projectRoot)) {
    return "the project directory";
  }

  const syncedFolderName = getSyncedFolderName(outputPath);

  if (syncedFolderName) {
    return `a synced consumer cloud folder (${syncedFolderName})`;
  }

  return null;
}

function getSyncedFolderName(outputPath: string) {
  const lowerSegments = outputPath.toLowerCase().split(sep);
  const syncedFolderNames = ["dropbox", "google drive", "googledrive", "icloud drive", "icloud", "onedrive"];

  return syncedFolderNames.find((folderName) => lowerSegments.includes(folderName)) ?? null;
}

function isPathInside(targetPath: string, parentPath: string) {
  const pathRelative = relative(parentPath, targetPath);

  return pathRelative === "" || (!pathRelative.startsWith("..") && !pathRelative.startsWith(`..${sep}`) && !pathRelative.includes(`${sep}..${sep}`));
}
