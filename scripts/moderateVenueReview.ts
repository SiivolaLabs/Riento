import { createClient } from "@supabase/supabase-js";

type ModerationAction = "approve" | "reject";

type ReviewRow = {
  comment: string | null;
  hidden_at: string | null;
  id: string;
  moderation_status: string;
  rating: number;
  updated_at: string;
  venue_id: string;
};

const reviewId = process.argv[2];
const action = process.argv[3] as ModerationAction | undefined;
const isConfirmed = process.argv.includes("--confirm-moderation");
const confirmedReviewId = getArgValue("--confirm-review-id");
const reason = getArgValue("--reason")?.trim();
const moderatorId = process.env.RIENTO_MODERATOR_ID?.trim();
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!reviewId || !action || !["approve", "reject"].includes(action)) {
    throw new Error("Usage: npm run admin:moderate-review -- <review-id> <approve|reject> --reason <reason> --confirm-moderation --confirm-review-id <review-id>");
  }

  if (!isUuid(reviewId)) {
    throw new Error("Replace REVIEW_ID with the real venue_reviews UUID from the moderation queue.");
  }

  if (!reason) {
    throw new Error("Add a concise moderation reason with --reason.");
  }

  if (isConfirmed && confirmedReviewId !== reviewId) {
    throw new Error(`Confirmed moderation requires --confirm-review-id ${reviewId}.`);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this admin script.");
  }

  if (supabaseUrl.includes("PROJECT") || !/^https:\/\/[a-z]{20}\.supabase\.co\/?$/.test(supabaseUrl)) {
    throw new Error("SUPABASE_URL must be the real project URL, for example https://adytflvtwkizparpoazu.supabase.co.");
  }

  if (serviceRoleKey === "..." || serviceRoleKey.includes("YOUR_") || serviceRoleKey.length < 30) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is still a placeholder. Use the secret service-role key from Supabase Dashboard and never paste it into chat or commit it.");
  }

  if (!moderatorId) {
    throw new Error("Set RIENTO_MODERATOR_ID to the named operator handling this moderation action.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await adminClient
    .from("venue_reviews")
    .select("id,venue_id,rating,comment,moderation_status,hidden_at,updated_at")
    .eq("id", reviewId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Review not found.");
  }

  const review = data as ReviewRow;
  const { count, error: reportError } = await adminClient
    .from("venue_review_reports")
    .select("id", { count: "exact", head: true })
    .eq("review_id", review.id)
    .is("resolved_at", null);

  if (reportError) {
    throw new Error(reportError.message);
  }

  console.log(`Review ${review.id}: ${review.rating}/5 / ${review.moderation_status}`);
  console.log(`Text: ${JSON.stringify(review.comment ?? "No written text.")}`);
  console.log(`Open reports: ${count ?? 0}`);
  console.log(`Proposed action: ${action} / ${reason}`);

  if (!isConfirmed) {
    console.log(`Dry run only. Re-run with --confirm-moderation --confirm-review-id ${review.id} after checking the text and reports.`);
    return;
  }

  const { data: moderationResult, error: moderationError } = await adminClient.rpc("moderate_venue_review", {
    p_action: action,
    p_expected_updated_at: review.updated_at,
    p_operator_identifier: moderatorId,
    p_reason: reason,
    p_review_id: review.id
  });

  if (moderationError) {
    throw new Error(moderationError.message);
  }

  if (moderationResult?.ok !== true) {
    throw new Error(moderationResult?.message ?? "Review moderation was not applied.");
  }

  console.log(`${action === "approve" ? "Approved" : "Rejected"} review ${review.id} and resolved its open reports.`);
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag);
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;

  return value && !value.startsWith("--") ? value : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
