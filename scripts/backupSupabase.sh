#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ -z "${RIENTO_BACKUP_DIR:-}" ]]; then
  echo "Set RIENTO_BACKUP_DIR to an encrypted directory outside this repository." >&2
  exit 1
fi

project_root="$(pwd -P)"
backup_root="$(mkdir -p "$RIENTO_BACKUP_DIR" && cd "$RIENTO_BACKUP_DIR" && pwd -P)"

case "$backup_root" in
  "$project_root"|"$project_root"/*|/tmp|/tmp/*|*iCloud*|*Dropbox*|*Google\ Drive*|*OneDrive*)
    echo "Backup destination must be encrypted, private, and outside the repository or sync folders." >&2
    exit 1
    ;;
esac

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="$backup_root/riento-$timestamp"
mkdir "$output_dir"

supabase db dump --linked --role-only -f "$output_dir/roles.sql"
supabase db dump --linked -f "$output_dir/schema.sql"
supabase db dump --linked --data-only --use-copy -f "$output_dir/data.sql"

(
  cd "$output_dir"
  shasum -a 256 roles.sql schema.sql data.sql > SHA256SUMS
)

cat > "$output_dir/MANIFEST.txt" <<EOF
created_at=$timestamp
source_project=linked-supabase-project
restore_policy=restore-only-to-an-isolated-project-after-manual-approval
EOF

echo "Encrypted logical backup written to $output_dir"
