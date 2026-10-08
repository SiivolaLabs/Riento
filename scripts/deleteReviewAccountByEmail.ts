import { createClient, type User } from "@supabase/supabase-js";

const accountEmail = process.argv[2]?.trim().toLowerCase();
const isConfirmed = process.argv.includes("--confirm-delete-account");
const confirmedUserId = getArgValue("--confirm-user-id");
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!accountEmail) {
    throw new Error("Usage: npm run admin:delete-review-account -- EMAIL --confirm-delete-account --confirm-user-id USER_ID");
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this admin script.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const account = await getUserByEmail(adminClient, accountEmail);

  if (!account || account.is_anonymous) {
    throw new Error("A permanent review account with that email was not found.");
  }

  console.log(`Review account: ${account.email} / ${account.id}`);

  if (!isConfirmed) {
    console.log(`Dry run only. Verify control of ${account.email}, then re-run with --confirm-delete-account --confirm-user-id ${account.id}.`);
    return;
  }

  if (confirmedUserId !== account.id) {
    throw new Error(`Confirmed deletion requires --confirm-user-id ${account.id}.`);
  }

  const { data: deletionResult, error: deletionError } = await adminClient.rpc("delete_identity_data", { p_user_id: account.id });

  if (deletionError || deletionResult?.ok !== true) {
    throw new Error(deletionError?.message ?? "Could not delete account data.");
  }

  const { error: authError } = await adminClient.auth.admin.deleteUser(account.id, false);

  if (authError) {
    throw new Error(`Account data was deleted, but Auth deletion failed: ${authError.message}`);
  }

  const { error: refreshError } = await adminClient.rpc("refresh_crowd_snapshots", { p_window_minutes: 90 });

  if (refreshError) {
    console.warn(`Account deleted; crowd reconciliation will retry on schedule: ${refreshError.message}`);
  }

  console.log(`Deleted review account ${account.id}.`);
}

async function getUserByEmail(adminClient: any, email: string): Promise<User | null> {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find((user: User) => user.email?.trim().toLowerCase() === email);

    if (match) {
      return match;
    }

    if (data.users.length < 1000) {
      return null;
    }
  }

  throw new Error("Account lookup exceeded the safe pagination limit.");
}

function getArgValue(flag: string) {
  const flagIndex = process.argv.indexOf(flag);
  const value = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
