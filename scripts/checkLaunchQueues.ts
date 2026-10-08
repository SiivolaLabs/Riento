import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type QueueResult = {
  count: number;
  label: string;
  oldestAt: string | null;
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on a trusted operator machine.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const queues = await Promise.all([
    checkQueue(client, "Pending written reviews", "venue_reviews", "updated_at", (query) => query.not("comment", "is", null).eq("moderation_status", "pending")),
    checkQueue(client, "Urgent review reports", "venue_review_reports", "created_at", (query) => query.is("resolved_at", null).in("reason", ["safety_threat", "personal_information"])),
    checkQueue(client, "Other review reports", "venue_review_reports", "created_at", (query) => query.is("resolved_at", null).not("reason", "in", "(safety_threat,personal_information)")),
    checkQueue(client, "Venue reports", "venue_reports", "created_at", (query) => query.is("resolved_at", null)),
    checkQueue(client, "Music reports", "venue_music_reports", "created_at", (query) => query.is("resolved_at", null)),
    checkQueue(client, "Stuck deletion operations", "identity_deletion_operations", "updated_at", (query) => query.eq("status", "processing").lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString()))
  ]);

  for (const queue of queues) {
    const oldest = queue.oldestAt ? `, oldest ${formatAge(queue.oldestAt)}` : "";
    console.log(`${queue.label}: ${queue.count}${oldest}`);
  }

  const urgentBreaches = queues.filter((queue) => queue.label === "Urgent review reports" && queue.oldestAt && Date.now() - new Date(queue.oldestAt).getTime() > 24 * 60 * 60_000);
  const deletionFailures = queues.filter((queue) => queue.label === "Stuck deletion operations" && queue.count > 0);

  if (urgentBreaches.length > 0 || deletionFailures.length > 0) {
    throw new Error("Launch operations require immediate attention before rollout continues.");
  }
}

async function checkQueue(
  client: SupabaseClient,
  label: string,
  table: string,
  timestampColumn: string,
  applyFilters: (query: any) => any
): Promise<QueueResult> {
  let query = client.from(table).select(timestampColumn, { count: "exact" });
  query = applyFilters(query).order(timestampColumn, { ascending: true }).limit(1);
  const { count, data, error } = await query;

  if (error) {
    throw new Error(`${label} check failed: ${error.message}`);
  }

  const row = data?.[0] as unknown as Record<string, string> | undefined;
  return { count: count ?? 0, label, oldestAt: row?.[timestampColumn] ?? null };
}

function formatAge(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes >= 60 ? `${Math.round(minutes / 60)}h ago` : `${minutes}m ago`;
}
