#!/usr/bin/env bash
# Push production secrets into the deployed Worker's secret store.
#
# Secret values are read from environment variables (populated by `fnox exec`)
# and piped straight into `wrangler secret put` over stdin, so they are never
# printed to the terminal, shell history, or logs. Run it as:
#
#   bun run secrets:sync          # == fnox exec -- bash scripts/sync-secrets.sh
#
# The Worker must already exist, so run `wrangler deploy` once before the first
# sync. `wrangler secret put` values override the placeholder `vars` baked into
# wrangler.jsonc and take effect immediately (no redeploy needed).
set -euo pipefail

WORKER="${WORKER_NAME:-bookclub}"
SECRETS=(SESSION_HMAC_SECRET ADMIN_API_TOKEN EMAIL_FROM)

for name in "${SECRETS[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    echo "[sync-secrets] skip ${name}: not present in environment" >&2
    continue
  fi
  echo "[sync-secrets] setting ${name} on Worker '${WORKER}'..."
  printf %s "$value" | bunx wrangler secret put "$name" --name "$WORKER"
done
